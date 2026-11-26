import { iconSvg, type IconName } from '@/lib/icons';

/** Icon from the site's icon set (Fluent UI System Icons, see src/lib/icons.ts), for React. */
export default function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <span
      className="icon-wrap"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: iconSvg(name, className ? `icon ${className}` : 'icon') }}
    />
  );
}
