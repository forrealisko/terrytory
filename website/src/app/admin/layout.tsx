import { Sidebar } from "@/components/Sidebar";

export default function DashboardLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="dashboard-layout">
      <div className="ufo-bg-particles" aria-hidden="true">
        <div className="ufo-particle ufo-particle--ufo"></div>
        <div className="ufo-particle ufo-particle--meteor"></div>
        <div className="ufo-particle ufo-particle--planet"></div>
        <div className="ufo-particle ufo-particle--spark"></div>
        <div className="ufo-particle ufo-particle--ufo"></div>
        <div className="ufo-particle ufo-particle--meteor"></div>
        <div className="ufo-particle ufo-particle--spark"></div>
        <div className="ufo-particle ufo-particle--planet"></div>
      </div>
      <Sidebar />
      <main className="main-content">{children}</main>
    </div>
  );
}
