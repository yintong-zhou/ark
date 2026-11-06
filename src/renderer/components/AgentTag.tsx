import type { AgentId } from '@shared/types';
import { AGENT_NAME } from '../agents';
import { EngineLogo } from './Logos';

/** The mark of an engine in a 24px slot, so rows of agents line up. OpenCode keeps a monogram. */
export function AgentTag({ id }: { id: AgentId }) {
  return (
    <span title={AGENT_NAME[id]} className="flex size-3 shrink-0 items-center justify-center">
      <EngineLogo id={id} size={18} />
    </span>
  );
}
