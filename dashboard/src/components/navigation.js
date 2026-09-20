import { Activity, Home, Image, Settings, Terminal, Users } from 'lucide-react';

export const NAV_GROUPS = [
  {
    label: '概览',
    items: [
      { icon: Home, label: '运行状态', href: '/', badge: 'Live' }
    ]
  },
  {
    label: '配置',
    items: [
      { icon: Users, label: '群组管理', href: '/groups', badge: 'Groups' },
      { icon: Settings, label: '系统设置', href: '/settings', badge: 'Config' }
    ]
  },
  {
    label: '诊断',
    items: [
      { icon: Image, label: '预览编辑器', href: '/preview-layout', badge: 'Cards' },
      { icon: Terminal, label: '系统日志', href: '/logs', badge: 'Logs' }
    ]
  }
];

export const NAV_ITEMS = NAV_GROUPS.flatMap((group) => group.items);
