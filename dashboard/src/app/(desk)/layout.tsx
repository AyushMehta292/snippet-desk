import { redirect } from "next/navigation";
import { Rail } from "@/components/rail";
import { getCurrentUser } from "@/lib/auth";

export default async function DeskLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return (
    <div className="app">
      <Rail email={user.email} />
      <main className="stage">{children}</main>
    </div>
  );
}
