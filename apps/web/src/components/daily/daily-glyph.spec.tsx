import "@testing-library/jest-dom/vitest";
import React from "react";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  StreakGlyph,
  CountdownGlyph,
  CheckGlyph,
  CrossGlyph,
  CardsGlyph,
  TrophyGlyph,
  RankOneCrownGlyph,
} from "./daily-glyph";

describe("Daily Glyphs", () => {
  it("renders StreakGlyph with default and custom props", () => {
    const { container: defaultSvg } = render(<StreakGlyph />);
    const svg = defaultSvg.querySelector("svg");
    expect(svg).toBeInTheDocument();
    expect(svg).toHaveAttribute("width", "14");
    expect(svg).toHaveAttribute("height", "14");

    const { container: customSvg } = render(
      <StreakGlyph className="custom-flame" size={24} />,
    );
    const custom = customSvg.querySelector("svg");
    expect(custom).toHaveClass("custom-flame");
    expect(custom).toHaveAttribute("width", "24");
    expect(custom).toHaveAttribute("height", "24");
  });

  it("renders CountdownGlyph with default and custom props", () => {
    const { container: defaultSvg } = render(<CountdownGlyph />);
    const svg = defaultSvg.querySelector("svg");
    expect(svg).toBeInTheDocument();
    expect(svg).toHaveAttribute("width", "14");

    const { container: customSvg } = render(
      <CountdownGlyph className="custom-timer" size={20} />,
    );
    const custom = customSvg.querySelector("svg");
    expect(custom).toHaveClass("custom-timer");
    expect(custom).toHaveAttribute("width", "20");
  });

  it("renders CheckGlyph with default and custom props", () => {
    const { container: defaultSvg } = render(<CheckGlyph />);
    const svg = defaultSvg.querySelector("svg");
    expect(svg).toBeInTheDocument();
    expect(svg).toHaveAttribute("width", "16");

    const { container: customSvg } = render(
      <CheckGlyph className="custom-check" size={22} />,
    );
    const custom = customSvg.querySelector("svg");
    expect(custom).toHaveClass("custom-check");
    expect(custom).toHaveAttribute("width", "22");
  });

  it("renders CrossGlyph with default and custom props", () => {
    const { container: defaultSvg } = render(<CrossGlyph />);
    const svg = defaultSvg.querySelector("svg");
    expect(svg).toBeInTheDocument();
    expect(svg).toHaveAttribute("width", "16");

    const { container: customSvg } = render(
      <CrossGlyph className="custom-cross" size={22} />,
    );
    const custom = customSvg.querySelector("svg");
    expect(custom).toHaveClass("custom-cross");
    expect(custom).toHaveAttribute("width", "22");
  });

  it("renders CardsGlyph with default and custom props", () => {
    const { container: defaultSvg } = render(<CardsGlyph />);
    const svg = defaultSvg.querySelector("svg");
    expect(svg).toBeInTheDocument();
    expect(svg).toHaveAttribute("width", "14");

    const { container: customSvg } = render(
      <CardsGlyph className="custom-cards" size={28} />,
    );
    const custom = customSvg.querySelector("svg");
    expect(custom).toHaveClass("custom-cards");
    expect(custom).toHaveAttribute("width", "28");
  });

  it("renders TrophyGlyph with default and custom props", () => {
    const { container: defaultSvg } = render(<TrophyGlyph />);
    const svg = defaultSvg.querySelector("svg");
    expect(svg).toBeInTheDocument();
    expect(svg).toHaveAttribute("width", "18");

    const { container: customSvg } = render(
      <TrophyGlyph className="custom-trophy" size={32} />,
    );
    const custom = customSvg.querySelector("svg");
    expect(custom).toHaveClass("custom-trophy");
    expect(custom).toHaveAttribute("width", "32");
  });

  it("renders RankOneCrownGlyph with default and custom props", () => {
    const { container: defaultSvg } = render(<RankOneCrownGlyph />);
    const svg = defaultSvg.querySelector("svg");
    expect(svg).toBeInTheDocument();
    expect(svg).toHaveAttribute("width", "16");

    const { container: customSvg } = render(
      <RankOneCrownGlyph className="custom-crown" size={20} />,
    );
    const custom = customSvg.querySelector("svg");
    expect(custom).toHaveClass("custom-crown");
    expect(custom).toHaveAttribute("width", "20");
  });
});
