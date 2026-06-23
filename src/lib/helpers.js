export const isWorkingDay = (date) => {
  const day = new Date(date).getDay();
  return day !== 5;
};

export const getWorkingDaysInMonth = (year, month) => {
  const days = [];
  const date = new Date(year, month - 1, 1);
  while (date.getMonth() === month - 1) {
    if (isWorkingDay(date)) days.push(new Date(date));
    date.setDate(date.getDate() + 1);
  }
  return days;
};

export const getRemainingWorkingDays = (year, month) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const allWorkingDays = getWorkingDaysInMonth(year, month);
  return allWorkingDays.filter(d => d > today).length;
};

export const getPassedWorkingDays = (year, month) => {
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  const allWorkingDays = getWorkingDaysInMonth(year, month);
  return allWorkingDays.filter(d => d <= today).length;
};

export const getTotalWorkingDaysInMonth = (year, month) => {
  return getWorkingDaysInMonth(year, month).length;
};

export const getMonthProgress = (year, month) => {
  const total = getTotalWorkingDaysInMonth(year, month);
  const passed = getPassedWorkingDays(year, month);
  return total > 0 ? (passed / total) * 100 : 0;
};

export const formatNumber = (num) => {
  if (!num && num !== 0) return '0';
  return new Intl.NumberFormat('ar-SA').format(Math.round(num));
};

export const formatCurrency = (num) => {
  if (!num && num !== 0) return '0';
  return new Intl.NumberFormat('ar-SA').format(Math.round(num));
};

export const getAchievementStatus = (achieved, target, monthProgress) => {
  if (target === 0) return 'no-target';
  const achievementRate = (achieved / target) * 100;
  if (achievementRate >= monthProgress + 5) return 'ahead';
  if (achievementRate >= monthProgress - 5) return 'on-track';
  return 'behind';
};

export const getStatusColor = (status) => {
  switch (status) {
    case 'ahead': return '#10b981';
    case 'on-track': return '#f59e0b';
    case 'behind': return '#ef4444';
    default: return '#6b7280';
  }
};

export const getStatusLabel = (status) => {
  switch (status) {
    case 'ahead': return 'متقدم';
    case 'on-track': return 'في المسار';
    case 'behind': return 'متأخر';
    default: return '-';
  }
};

export const MONTHS_AR = [
  'يناير', 'فبراير', 'مارس', 'إبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'
];

