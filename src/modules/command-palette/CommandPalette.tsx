import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import type { IconSvgElement } from "@hugeicons/react";
import { HugeiconsIcon } from "@hugeicons/react";

export type CommandPaletteAction = {
  id: string;
  label: string;
  group: string;
  shortcut?: string;
  disabled?: boolean;
  icon?: IconSvgElement;
  run: () => void;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  actions: CommandPaletteAction[];
};

export function CommandPalette({ open, onOpenChange, actions }: Props) {
  const groups = groupedActions(actions);

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <Command>
        <CommandInput placeholder="Run a command..." />
        <CommandList>
          <CommandEmpty>No matching command.</CommandEmpty>
          {groups.map((group) => (
            <CommandGroup key={group.name} heading={group.name}>
              {group.actions.map((action) => (
                <CommandItem
                  key={action.id}
                  value={`${action.group} ${action.label}`}
                  disabled={action.disabled}
                  onSelect={() => {
                    onOpenChange(false);
                    action.run();
                  }}
                >
                  {action.icon ? (
                    <HugeiconsIcon
                      icon={action.icon}
                      size={15}
                      strokeWidth={1.8}
                    />
                  ) : null}
                  <span className="truncate">{action.label}</span>
                  {action.shortcut ? (
                    <CommandShortcut>{action.shortcut}</CommandShortcut>
                  ) : null}
                </CommandItem>
              ))}
            </CommandGroup>
          ))}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}

function groupedActions(actions: CommandPaletteAction[]) {
  const order: string[] = [];
  const byGroup = new Map<string, CommandPaletteAction[]>();
  for (const action of actions) {
    if (!byGroup.has(action.group)) {
      order.push(action.group);
      byGroup.set(action.group, []);
    }
    byGroup.get(action.group)?.push(action);
  }
  return order.map((name) => ({ name, actions: byGroup.get(name) ?? [] }));
}
