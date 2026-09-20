function formatLogFields(fields = {}) {
  const entries = Object.entries(fields).filter(([, value]) => value !== undefined && value !== null && value !== '');
  if (entries.length === 0) return '';
  return entries
    .map(([key, value]) => {
      if (typeof value === 'string') {
        return /\s/.test(value) ? `${key}=${JSON.stringify(value)}` : `${key}=${value}`;
      }
      if (typeof value === 'object') {
        return `${key}=${JSON.stringify(value)}`;
      }
      return `${key}=${String(value)}`;
    })
    .join(' ');
}

export function getLogMessageText(log = {}) {
  const action = log.action || '';
  const fieldsText = formatLogFields(log.fields);
  if (action) {
    return `${action}${fieldsText ? ` ${fieldsText}` : ''}`;
  }
  return log.rendered || log.message || '-';
}

export function buildLogExportContent(logs = []) {
  return logs
    .map((log) => JSON.stringify({
      timestamp: log.timestamp || '',
      level: log.level || '',
      channel: log.channel || '',
      scope: log.scope || '',
      action: log.action || '',
      fields: log.fields && typeof log.fields === 'object' ? log.fields : {},
      message: getLogMessageText(log),
    }))
    .join('\n');
}

function padDatePart(value) {
  return String(value).padStart(2, '0');
}

export function formatLogExportFilename(date = new Date()) {
  return [
    'subx-bot-logs-',
    date.getFullYear(),
    padDatePart(date.getMonth() + 1),
    padDatePart(date.getDate()),
    '-',
    padDatePart(date.getHours()),
    padDatePart(date.getMinutes()),
    padDatePart(date.getSeconds()),
    '.jsonl',
  ].join('');
}

export function downloadLogExport(logs = [], {
  documentRef = document,
  urlRef = URL,
  now = new Date(),
} = {}) {
  if (!Array.isArray(logs) || logs.length === 0) {
    return null;
  }

  const content = buildLogExportContent(logs);
  const blob = new Blob([content], { type: 'application/x-ndjson;charset=utf-8' });
  const url = urlRef.createObjectURL(blob);
  const filename = formatLogExportFilename(now);
  const link = documentRef.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  documentRef.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => urlRef.revokeObjectURL(url), 0);
  return filename;
}
