import { MotionRoot } from './motion';
import { Header } from './sections/Header';
import { Hero } from './sections/Hero';
import { Usage } from './sections/Usage';
import { Threads } from './sections/Threads';
import { Control } from './sections/Control';
import { Tools } from './sections/Tools';
import { Install } from './sections/Install';
import { Footer } from './sections/Footer';

export function App() {
  return (
    <MotionRoot>
      <Header />
      <main>
        <Hero />
        <Usage />
        <Threads />
        <Control />
        <Tools />
        <Install />
      </main>
      <Footer />
    </MotionRoot>
  );
}
