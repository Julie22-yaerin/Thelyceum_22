import Navbar from "./components/Navbar";
import HeroSection from "./components/HeroSection";
import InfoSection from "./components/InfoSection";
import RunsOnSection from "./components/RunsOnSection";
import UseCasesSection from "./components/UseCasesSection";

export default function App() {
  return (
    <div className="flex flex-col bg-[#F5F5F5]">
      <div className="h-screen flex flex-col overflow-hidden">
        <Navbar />
        <HeroSection />
      </div>
      <InfoSection />
      <RunsOnSection />
      <UseCasesSection />
    </div>
  );
}
