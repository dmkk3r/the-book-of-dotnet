/**
 * The only icon set of the site: Fluent UI System Icons (Microsoft, MIT licence,
 * github.com/microsoft/fluentui-system-icons), package @fluentui/svg-icons.
 * Icons are inlined at build time; there are no requests at runtime.
 *
 * Use them through <Icon name="…" /> (Astro), <Icon name="…" /> from
 * src/components/Icon.tsx (React) or iconSvg() in client scripts. Never use Unicode symbols
 * (☰ ◐ ⧉ ✓ ▶ …) as icons.
 */
import arrowReset from '@fluentui/svg-icons/icons/arrow_reset_20_regular.svg?raw';
import checkmark from '@fluentui/svg-icons/icons/checkmark_16_regular.svg?raw';
import chevronDoubleLeft from '@fluentui/svg-icons/icons/chevron_double_left_20_regular.svg?raw';
import chevronDoubleRight from '@fluentui/svg-icons/icons/chevron_double_right_20_regular.svg?raw';
import chevronDown from '@fluentui/svg-icons/icons/chevron_down_12_regular.svg?raw';
import chevronRight from '@fluentui/svg-icons/icons/chevron_right_12_regular.svg?raw';
import copy from '@fluentui/svg-icons/icons/copy_16_regular.svg?raw';
import darkTheme from '@fluentui/svg-icons/icons/dark_theme_20_regular.svg?raw';
import diamond from '@fluentui/svg-icons/icons/diamond_16_regular.svg?raw';
import dismiss from '@fluentui/svg-icons/icons/dismiss_16_regular.svg?raw';
import dismissCircle from '@fluentui/svg-icons/icons/dismiss_circle_16_regular.svg?raw';
import filter from '@fluentui/svg-icons/icons/filter_16_regular.svg?raw';
import globe from '@fluentui/svg-icons/icons/globe_16_regular.svg?raw';
import errorCircle from '@fluentui/svg-icons/icons/error_circle_16_regular.svg?raw';
import info from '@fluentui/svg-icons/icons/info_16_regular.svg?raw';
import lightbulb from '@fluentui/svg-icons/icons/lightbulb_16_regular.svg?raw';
import navigation from '@fluentui/svg-icons/icons/navigation_20_regular.svg?raw';
import open from '@fluentui/svg-icons/icons/open_16_regular.svg?raw';
import pause from '@fluentui/svg-icons/icons/pause_20_filled.svg?raw';
import play from '@fluentui/svg-icons/icons/play_20_filled.svg?raw';
import search from '@fluentui/svg-icons/icons/search_20_regular.svg?raw';
import warning from '@fluentui/svg-icons/icons/warning_16_regular.svg?raw';
import weatherMoon from '@fluentui/svg-icons/icons/weather_moon_16_regular.svg?raw';
import weatherSunny from '@fluentui/svg-icons/icons/weather_sunny_16_regular.svg?raw';

export const ICONS = {
  check: checkmark,
  'chevron-down': chevronDown,
  'chevron-right': chevronRight,
  collapse: chevronDoubleLeft,
  copy,
  decision: diamond,
  dismiss,
  expand: chevronDoubleRight,
  external: open,
  filter,
  globe,
  menu: navigation,
  pause,
  play,
  reset: arrowReset,
  search,
  'theme-dark': weatherMoon,
  'theme-light': weatherSunny,
  'theme-system': darkTheme,
  // Alerts (as on documentation sites)
  note: errorCircle,
  tip: lightbulb,
  important: info,
  caution: dismissCircle,
  warning,
} as const;

export type IconName = keyof typeof ICONS;

/** SVG markup of an icon: fills with the text colour, hidden from assistive technology. */
export function iconSvg(name: IconName, className = 'icon'): string {
  return ICONS[name].replace(
    /^<svg /,
    `<svg class="${className}" fill="currentColor" aria-hidden="true" focusable="false" `,
  );
}
