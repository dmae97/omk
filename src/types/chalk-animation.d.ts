declare module "chalk-animation" {
  export interface ChalkAnimationController {
    stop(): ChalkAnimationController;
    start(): ChalkAnimationController;
    replace(text: string): ChalkAnimationController;
  }

  export type ChalkAnimationEffect = "rainbow" | "pulse" | "glitch" | "radar" | "neon" | "karaoke";

  const chalkAnimation: Record<ChalkAnimationEffect, (text: string, speed?: number) => ChalkAnimationController>;
  export default chalkAnimation;
}
