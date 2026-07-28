import WorkforceCanvas from "@/components/WorkforceCanvas";
import CompanySetupDialog from "@/components/CompanySetupDialog";

export default function WorkforceCanvasPage() {
  return (
    <div className="fixed inset-0 bg-[#08080c]">
      <WorkforceCanvas />
      <CompanySetupDialog />
    </div>
  );
}
