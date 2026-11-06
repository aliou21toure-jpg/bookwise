import { redirect } from "next/navigation";

/** The customer's bookings moved into the dashboard; old links keep working. */
export default function BookingsPage() {
  redirect("/dashboard/upcoming");
}
