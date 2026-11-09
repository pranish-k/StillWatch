/**
 * Plain text where `backtick` spans render as inline code, for messages the
 * collector writes. Still text only: nothing is interpreted as markup.
 */
export function CodeText({ text }: { text: string }) {
  const parts = text.split('`');
  // An odd number of parts means the backticks are balanced.
  if (parts.length < 3 || parts.length % 2 === 0) return <>{text}</>;
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <code key={i} className="mono inline-code">
            {part}
          </code>
        ) : (
          part
        ),
      )}
    </>
  );
}
