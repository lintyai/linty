import Layout from '@theme/Layout';
import Hero from '@site/src/components/Hero.component';
import SocialProof from '@site/src/components/SocialProof.component';
import Features from '@site/src/components/Features.component';
import HowItWorks from '@site/src/components/HowItWorks.component';
import LanguageShowcase from '@site/src/components/LanguageShowcase.component';
import Pricing from '@site/src/components/Pricing.component';
import Testimonials from '@site/src/components/Testimonials.component';
import FAQ from '@site/src/components/FAQ.component';
import FinalCTA from '@site/src/components/FinalCTA.component';
import Footer from '@site/src/components/Footer.component';

export default function Home() {
  return (
    <Layout
      title="Voice-to-Text for macOS"
      description="Real-time voice-to-text that lives in your menu bar. Speak in any language, get perfect text — pasted right where you need it. Download free for macOS."
    >
      <main>
        <Hero />
        <SocialProof />
        <Features />
        <HowItWorks />
        <LanguageShowcase />
        <Pricing />
        <Testimonials />
        <FAQ />
        <FinalCTA />
      </main>
      <Footer />
    </Layout>
  );
}
