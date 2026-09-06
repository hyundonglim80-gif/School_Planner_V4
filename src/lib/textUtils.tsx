import React from 'react';

/**
 * 텍스트 내의 웹 URL(http://, https://)을 감지하여 클릭 가능한 하이퍼링크로 자동 변환합니다.
 */
export function renderFormattedText(text: string): React.ReactNode {
  if (!text) return '';
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const parts = text.split(urlRegex);

  return parts.map((part, i) => {
    if (part.match(urlRegex)) {
      return (
        <a
          key={i}
          href={part}
          target="_blank"
          rel="noreferrer"
          className="text-blue-600 hover:text-blue-800 underline font-semibold break-all inline-flex items-center gap-0.5 mx-0.5"
          onClick={(e) => e.stopPropagation()}
        >
          <span>🔗</span>
          <span>{part.length > 40 ? part.substring(0, 37) + '...' : part}</span>
        </a>
      );
    }
    return part;
  });
}
