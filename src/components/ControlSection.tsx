import { useState } from 'react';
import type { ReactNode } from 'react';

interface ControlSectionProps {
  title: string;
  open?: boolean;
  children: ReactNode;
}

export function ControlSection({ title, open = true, children }: ControlSectionProps) {
  const [isOpen, setIsOpen] = useState(open);

  return (
    <div className={`pc-section ${!isOpen ? 'collapsed' : ''}`}>
      <button
        type="button"
        className="pc-section-title"
        onClick={() => setIsOpen(!isOpen)}
      >
        {title}
      </button>
      <div className="pc-section-body">{children}</div>
    </div>
  );
}
