<?php

declare(strict_types=1);

/**
 * Guards the shipped LiveKit token TTL (docs/video-platform/06-WEB-CALL-CLIENT §5 + the SDK reality
 * note): a LiveKit access token is the credential the client re-auths with when the SDK auto-resumes
 * after a network blip. A connected participant is NOT dropped when the token expires — only
 * (re)connection re-checks it — so the token must comfortably OUTLIVE a full 30–90 min lesson, or a
 * mid-call blip on a long call fails to reconnect and drops the participant.
 *
 * No beforeEach override here: config('services.livekit.token_ttl') resolves to the shipped default
 * in config/services.php (no LIVEKIT_TOKEN_TTL in the test env), so this pins what we actually ship.
 */
it('ships a video token TTL long enough to outlive a full lesson', function () {
    expect((int) config('services.livekit.token_ttl'))->toBeGreaterThanOrEqual(7200); // >= 2h
});
