export const validateNightMode = (nightMode) => {
  if (nightMode?.mode !== 'timed') return null;

  const timeRegex = /^\d{1,2}:\d{2}$/;
  if (!timeRegex.test(nightMode.startTime) || !timeRegex.test(nightMode.endTime)) {
    return '时间格式不正确，请使用 HH:mm 格式';
  }

  const [startH, startM] = nightMode.startTime.split(':').map(Number);
  const [endH, endM] = nightMode.endTime.split(':').map(Number);

  if (
    startH < 0 || startH > 23 || startM < 0 || startM > 59 ||
    endH < 0 || endH > 23 || endM < 0 || endM > 59
  ) {
    return '时间超出有效范围（00:00-23:59）';
  }

  return null;
};

// 兼容两种身份：数字 QQ 号（5-11 位）或官方 provider 的 openid
// （与后端 SAFE_ENTITY_ID_PATTERN 一致：[A-Za-z0-9:_-]，最长 200 字符）
const OPENID_PATTERN = /^[A-Za-z0-9:_-]{1,200}$/;

export const validateAdminQQ = (qq) => {
  const value = String(qq ?? '').trim();
  if (/^\d+$/.test(value)) {
    if (value.length < 5 || value.length > 11) {
      return 'QQ 号长度不正确（应为 5-11 位）';
    }
    return null;
  }

  if (OPENID_PATTERN.test(value)) {
    return null;
  }

  return '请输入有效的 QQ 号或 OpenID';
};
