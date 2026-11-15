import { HelpVideosScreen } from "./screen";

/**
 * Super Admin → help videos: attach a recording (an upload, or a YouTube / Vimeo link) to each
 * place the in-app help can play one. Platform scoped (`platform.manage`); the `help_videos` RLS
 * policy re-asserts SUPER_ADMIN on every write.
 */
export default function AdminHelpVideosPage() {
  return <HelpVideosScreen />;
}
