import { EnrolmentScreen } from "./screen";

/**
 * The centre's enrolment inbox (docs/centre-profile Phase 2 §6): the public form's link and what it
 * collected. Same authenticated shell as the rest of the app; the screen is gated client-side on
 * `trial.read` + the `centre` switch, and the API enforces both for real (Gate + entitled:centre).
 */
export default function EnrolmentPage() {
  return <EnrolmentScreen />;
}
