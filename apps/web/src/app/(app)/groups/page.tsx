import { GroupsScreen } from "./screen";

/**
 * Group classes route (docs/groups). Same authenticated shell as the rest of the app; the screen is
 * permission-gated client-side (group.read) and the API enforces it for real — every endpoint is
 * behind `entitled:groups` and a Gate::authorize, with a TEACHER row-scoped to their own groups.
 */
export default function GroupsPage() {
  return <GroupsScreen />;
}
