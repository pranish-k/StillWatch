import { type AnchorHTMLAttributes, type MouseEvent, type Ref } from 'react';
import { navigate } from './router';

type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & {
  to: string;
  replace?: boolean;
  ref?: Ref<HTMLAnchorElement>;
};

function isPlainClick(event: MouseEvent<HTMLAnchorElement>): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

/** A real anchor that navigates in place on a plain click. */
export function Link({ to, replace, onClick, ref, ...rest }: LinkProps) {
  return (
    <a
      {...rest}
      ref={ref}
      href={to}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented || !isPlainClick(event)) return;
        event.preventDefault();
        navigate(to, { replace: replace === true });
      }}
    />
  );
}
