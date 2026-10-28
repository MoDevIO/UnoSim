import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import type { ExampleBoardPrompt } from "@/lib/example-board";

interface ExampleBoardPromptDialogProps {
  readonly prompt: ExampleBoardPrompt | undefined;
  readonly onSwitch: () => void;
  readonly onLoadAnyway: () => void;
  readonly onCancel: () => void;
}

/** Asks what to do with an example written for another board than the selected one (plan P4.6). */
export function ExampleBoardPromptDialog({ prompt, onSwitch, onLoadAnyway, onCancel }: ExampleBoardPromptDialogProps) {
  return (
    <AlertDialog open={prompt !== undefined} onOpenChange={(open) => !open && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Example for {prompt?.exampleBoardName}</AlertDialogTitle>
          <AlertDialogDescription>
            This example is written for {prompt?.exampleBoardName}; the selected board is {prompt?.selectedBoardName}.
            {prompt?.canSwitch
              ? " Switching the board stops a running simulation."
              : ` ${prompt?.exampleBoardName} is not available in this installation yet.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>Cancel</AlertDialogCancel>
          <Button variant="outline" onClick={onLoadAnyway}>Load anyway</Button>
          {prompt?.canSwitch && <AlertDialogAction onClick={onSwitch}>Switch to {prompt.exampleBoardName}</AlertDialogAction>}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
