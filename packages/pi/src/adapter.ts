import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { ImageContent, TextContent } from '@earendil-works/pi-ai';

import type { Message } from '@dereknex/jev-compaction';

function textFromContent(
  content: string | (TextContent | ImageContent)[],
): string {
  if (typeof content === 'string') return content;
  return content
    .filter((block): block is TextContent => block.type === 'text')
    .map((block) => block.text)
    .join('\n');
}

export function adaptMessages(messages: readonly AgentMessage[]): Message[] {
  return messages.map((message, sourceIndex): Message => {
    switch (message.role) {
      case 'assistant': {
        const text = message.content
          .flatMap((block) => {
            if (block.type === 'text') return [block.text];
            if (block.type === 'thinking')
              return [`[thinking]\n${block.thinking}`];
            return [];
          })
          .join('\n');
        const toolUses = message.content
          .filter((block) => block.type === 'toolCall')
          .map((block) => ({
            tool_use_id: block.id,
            toolCallId: block.id,
            tool: block.name,
            input: block.arguments,
          }));
        return {
          sourceIndex,
          role: 'assistant',
          text,
          toolUses,
          toolResults: [],
        };
      }
      case 'toolResult': {
        return {
          sourceIndex,
          role: 'user',
          text: '',
          toolUses: [],
          toolResults: [
            {
              tool_use_id: message.toolCallId,
              toolCallId: message.toolCallId,
              text: textFromContent(message.content),
              isError: message.isError,
            },
          ],
        };
      }
      case 'user': {
        return {
          sourceIndex,
          role: 'user',
          text: textFromContent(message.content),
          toolUses: [],
          toolResults: [],
        };
      }
      case 'bashExecution': {
        return {
          sourceIndex,
          role: 'user',
          text: message.excludeFromContext
            ? ''
            : `$ ${message.command}\n${message.output}`,
          toolUses: [],
          toolResults: [],
        };
      }
      case 'custom': {
        return {
          sourceIndex,
          role: 'user',
          text: textFromContent(message.content),
          toolUses: [],
          toolResults: [],
        };
      }
      case 'branchSummary':
      case 'compactionSummary': {
        return {
          sourceIndex,
          role: 'user',
          text: message.summary,
          toolUses: [],
          toolResults: [],
        };
      }
      case 'system': {
        return {
          sourceIndex,
          role: 'user',
          text: textFromContent(message.content),
          toolUses: [],
          toolResults: [],
        };
      }
      default: {
        const unreachable: never = message;
        return unreachable;
      }
    }
  });
}
