import { redirect } from "next/navigation";

export default function GuestListScannerRedirect() {
  redirect("/scan");
}
