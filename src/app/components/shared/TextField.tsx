import { InfoTip } from "@/app/components/shared/InfoTip";

type TextFieldProps = React.ComponentProps<"input"> & {
  id: string;
  label: string;
  info?: React.ReactNode;
};

export function TextField({ id, label, info, ...props }: TextFieldProps) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        {info && <InfoTip>{info}</InfoTip>}
      </div>
      <input
        id={id}
        className="h-12 rounded-xl bg-muted px-4 text-base outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
        {...props}
      />
    </div>
  );
}
