import { CtaFooter } from "./components/CtaFooter";
import { Nav } from "./components/Nav";
import { HeroSection } from "./components/hero/HeroSection";
import { Composable } from "./components/sections/Composable";
import { HowItWorks } from "./components/sections/HowItWorks";
import { WorkflowShowcase } from "./components/sections/WorkflowShowcase";
import { ThemeProvider } from "./themes/theme-provider";
import { ThemeSwitcher } from "./themes/theme-switcher";

export function App() {
  return (
    <ThemeProvider>
      <ThemeSwitcher />
      <Nav />
      <HeroSection />
      <HowItWorks />
      <WorkflowShowcase />
      <Composable />
      <CtaFooter />
    </ThemeProvider>
  );
}
