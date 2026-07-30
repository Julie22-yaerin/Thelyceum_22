import WorkforceCanvas from "@/components/WorkforceCanvas";
import WorkspaceOnboarding from "@/components/WorkspaceOnboarding";

export default function WorkforceCanvasPage() {
  return (
    <div className="fixed inset-0 bg-ws-subtle">
      <WorkforceCanvas />
      <WorkspaceOnboarding />
    </div>
  );
}
