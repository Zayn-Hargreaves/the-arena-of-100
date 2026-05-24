import { Tooltip, TooltipProvider } from "./tooltip";
import { Button } from "./button";
import { JSX } from "react/jsx-dev-runtime";

export function TooltipDemo(): JSX.Element {
  return (
    <TooltipProvider>
      <div className="flex flex-col gap-4 p-4">
        <h1 className="text-2xl font-bold">Tooltip Demo</h1>

        <div className="flex items-center gap-4">
          <Tooltip content="This is a tooltip">
            <Button variant="primary">Hover me</Button>
          </Tooltip>

          <Tooltip content="This is a tooltip on the right" side="right">
            <Button variant="secondary">Right tooltip</Button>
          </Tooltip>

          <Tooltip content="This is a tooltip on the bottom" side="bottom">
            <Button variant="ghost">Bottom tooltip</Button>
          </Tooltip>
        </div>
      </div>
    </TooltipProvider>
  );
}
