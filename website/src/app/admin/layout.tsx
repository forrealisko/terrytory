import { Sidebar } from "@/components/Sidebar";

export default function DashboardLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="dashboard-layout">
      <div className="ufo-bg-particles">
        <div className="ufo-particle"></div>
        <div className="ufo-particle"></div>
        <div className="ufo-particle"></div>
        <div className="ufo-particle"></div>
        <div className="ufo-particle"></div>
      </div>
      <Sidebar />
      <main className="main-content">{children}</main>
    </div>
  );
}
