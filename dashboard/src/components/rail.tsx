"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

const links = [
  { href: "/snippets", label: "Snippets" },
  { href: "/control", label: "Live control" },
  { href: "/settings", label: "Typing" },
];

export function Rail({ email }: { email: string }) {
  const pathname = usePathname();
  const router = useRouter();

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <aside className="rail">
      <Link href="/snippets" className="wordmark">
        Snippet Desk
        <span>type it out</span>
      </Link>
      <nav className="nav">
        {links.map((link) => (
          <Link key={link.href} href={link.href} aria-current={pathname === link.href ? "page" : undefined}>
            {link.label}
          </Link>
        ))}
      </nav>
      <div className="rail-foot">
        <span>{email}</span>
        <button className="text-button" type="button" onClick={() => void logout()}>
          Sign out
        </button>
      </div>
    </aside>
  );
}
