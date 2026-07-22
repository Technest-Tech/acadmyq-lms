<?php

declare(strict_types=1);

namespace App\Support\Lms;

use RuntimeException;
use Symfony\Component\Process\Process;

/**
 * The real ffmpeg-backed {@see HlsTranscoder} (docs/lms/04 — VOD, phase 3b). Probes the source, then
 * shells to ffmpeg to write a small HLS ladder — 360p always, plus 720p when the source is tall
 * enough — as a VOD master playlist with MPEG-TS segments (kept plain so the delivery route can
 * rewrite segment URIs line-by-line). Reuses the same object storage as the video platform once the
 * job uploads the output. ffmpeg runs only on a host that has it; this class is never invoked in CI.
 */
final class FfmpegHlsTranscoder implements HlsTranscoder
{
    private const MASTER = 'master.m3u8';

    public function transcode(string $sourcePath, string $outDir): TranscodeResult
    {
        $duration = $this->probeDuration($sourcePath);
        $height = $this->probeHeight($sourcePath);
        $hasAudio = $this->probeHasAudio($sourcePath);

        $this->run($this->ffmpegArgs($sourcePath, $outDir, $height, $hasAudio));

        if (! is_file($outDir.'/'.self::MASTER)) {
            throw new RuntimeException('ffmpeg produced no master playlist.');
        }

        return new TranscodeResult(self::MASTER, $duration);
    }

    /** The HLS ladder for a source of the given height: 360p, and 720p when the source reaches it. */
    private function ffmpegArgs(string $src, string $out, int $height, bool $hasAudio): array
    {
        $rungs = $height >= 720 ? [['h' => 360, 'v' => '800k', 'max' => '856k', 'buf' => '1200k'],
            ['h' => 720, 'v' => '2800k', 'max' => '2996k', 'buf' => '4200k']]
            : [['h' => 360, 'v' => '800k', 'max' => '856k', 'buf' => '1200k']];

        $args = [config('lms.media.ffmpeg_bin'), '-nostdin', '-y', '-i', $src];

        // One scaled video output per rung (H.264, fixed GOP so segments cut cleanly).
        $splits = implode('', array_map(fn (int $i): string => "[v{$i}]", array_keys($rungs)));
        $chains = [];
        foreach ($rungs as $i => $r) {
            $chains[] = "[v{$i}]scale=w=-2:h={$r['h']}[v{$i}out]";
        }
        $args[] = '-filter_complex';
        $args[] = '[0:v]split='.count($rungs).$splits.';'.implode(';', $chains);

        foreach ($rungs as $i => $r) {
            array_push($args,
                '-map', "[v{$i}out]",
                "-c:v:{$i}", 'libx264', "-profile:v:{$i}", 'main', '-preset', 'veryfast', '-crf', '23',
                '-g', '48', '-keyint_min', '48', '-sc_threshold', '0',
                "-b:v:{$i}", $r['v'], "-maxrate:v:{$i}", $r['max'], "-bufsize:v:{$i}", $r['buf'],
            );
        }

        // One AAC audio output per rung when the source has audio (var_stream_map pairs them 1:1).
        if ($hasAudio) {
            foreach (array_keys($rungs) as $i) {
                array_push($args, '-map', 'a:0', "-c:a:{$i}", 'aac', "-b:a:{$i}", '128k', '-ac', '2');
            }
        }

        $streamMap = implode(' ', array_map(
            fn (int $i): string => $hasAudio ? "v:{$i},a:{$i}" : "v:{$i}",
            array_keys($rungs),
        ));

        array_push($args,
            '-f', 'hls',
            '-hls_time', (string) (int) config('lms.media.hls_segment_seconds', 6),
            '-hls_playlist_type', 'vod',
            '-hls_flags', 'independent_segments',
            '-hls_segment_type', 'mpegts',
            '-hls_segment_filename', $out.'/v%v_%03d.ts',
            '-master_pl_name', self::MASTER,
            '-var_stream_map', $streamMap,
            $out.'/v%v.m3u8',
        );

        return $args;
    }

    private function probeDuration(string $src): int
    {
        $out = $this->run([
            config('lms.media.ffprobe_bin'), '-v', 'error',
            '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', $src,
        ]);

        return (int) round((float) trim($out));
    }

    private function probeHeight(string $src): int
    {
        $out = $this->run([
            config('lms.media.ffprobe_bin'), '-v', 'error', '-select_streams', 'v:0',
            '-show_entries', 'stream=height', '-of', 'default=nw=1:nk=1', $src,
        ]);

        return (int) trim($out);
    }

    private function probeHasAudio(string $src): bool
    {
        $out = $this->run([
            config('lms.media.ffprobe_bin'), '-v', 'error', '-select_streams', 'a',
            '-show_entries', 'stream=index', '-of', 'csv=p=0', $src,
        ]);

        return trim($out) !== '';
    }

    /** Run a process, return stdout, or throw with stderr on a non-zero exit. */
    private function run(array $command): string
    {
        $process = new Process($command);
        $process->setTimeout((float) (int) config('lms.media.transcode_timeout_seconds', 7200));
        $process->run();

        if (! $process->isSuccessful()) {
            $err = trim($process->getErrorOutput()) ?: trim($process->getOutput());
            throw new RuntimeException('ffmpeg/ffprobe failed: '.mb_substr($err, 0, 400));
        }

        return $process->getOutput();
    }
}
