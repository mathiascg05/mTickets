"use client";

import { parseThemeColors, resolveCssVars } from "@/lib/themeColors";
import { useMemo } from "react";

type Props = {
  concert: { primaryColor?: string; themeColors?: string };
  children: React.ReactNode;
};

export default function EventTheme({ concert, children }: Props) {
  const style = useMemo(() => {
    const themeColors = parseThemeColors(concert.themeColors);
    const vars = resolveCssVars(themeColors, concert.primaryColor);
    return Object.keys(vars).length > 0 ? vars : undefined;
  }, [concert.primaryColor, concert.themeColors]);

  return (
    <div className="min-h-screen bg-background text-foreground" style={style}>
      {children}
    </div>
  );
}
