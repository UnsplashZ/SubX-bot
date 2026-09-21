import { Ban, Plus, Shield, Trash2 } from 'lucide-react';

const PermissionsTab = ({
  globalConfig,
  adminInput,
  setAdminInput,
  onAddAdmin,
  onRemoveAdmin,
  blacklistInput,
  setBlacklistInput,
  onAddBlacklist,
  onRemoveBlacklist,
  formData,
  actionLoading
}) => {
  return (
    <div className="focus:outline-none">
      <div className="space-y-6">
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-yellow-400" />
            <h3 className="text-lg font-semibold text-white">群组管理员</h3>
          </div>

          <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-4">
            <p className="text-sm text-white/70">
              群组管理员可以使用所有机器人指令，不受其他限制。
              {globalConfig.rootAdminQQ && (
                <span className="block mt-2 text-yellow-300">
                  根管理员: {globalConfig.rootAdminQQ}
                </span>
              )}
            </p>
          </div>

          <div className="flex gap-2">
            <input
              type="text"
              placeholder="输入 QQ 号或 OpenID..."
              value={adminInput}
              onChange={(e) => setAdminInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && onAddAdmin()}
              className="flex-1 bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-white focus:border-yellow-500 focus:outline-none"
            />
            <button
              onClick={onAddAdmin}
              disabled={!adminInput || actionLoading.admins}
              className="px-4 py-2 bg-yellow-600/20 text-yellow-300 border border-yellow-500/30 hover:bg-yellow-600/30 rounded-lg transition-colors disabled:opacity-50"
            >
              添加
            </button>
          </div>

          <div className="space-y-2">
            {formData.admins && formData.admins.length > 0 ? (
              formData.admins.map((qq) => (
                <div key={qq} className="flex items-center justify-between bg-white/5 border border-white/10 rounded-lg p-3">
                  <div className="flex items-center gap-3">
                    <Shield className="w-5 h-5 text-yellow-400" />
                    <span className="font-mono text-white">{qq}</span>
                  </div>
                  <button
                    onClick={() => onRemoveAdmin(qq)}
                    disabled={actionLoading.admins}
                    className="text-gray-400 hover:text-red-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              ))
            ) : (
              <div className="text-center text-gray-500 py-4">
                暂无管理员
              </div>
            )}
          </div>
        </div>

        <div className="space-y-4 pt-6 border-t border-white/10">
          <div className="flex items-center gap-2">
            <Ban className="w-5 h-5 text-red-400" />
            <h3 className="text-lg font-semibold text-white">黑名单</h3>
          </div>

          <div className="flex gap-2">
            <input
              type="text"
              placeholder="输入 QQ 号或 OpenID..."
              value={blacklistInput}
              onChange={(e) => setBlacklistInput(e.target.value)}
              className="flex-1 bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-white focus:border-red-500 focus:outline-none"
              onKeyDown={(e) => e.key === 'Enter' && onAddBlacklist()}
            />
            <button
              onClick={onAddBlacklist}
              disabled={actionLoading.blacklist}
              className="px-4 py-2 bg-red-600/80 hover:bg-red-500 rounded-lg text-white font-medium transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Plus size={16} />
              添加黑名单
            </button>
          </div>

          <div className="bg-black/20 rounded-lg border border-white/5 overflow-hidden">
            <div className="p-3 bg-white/5 text-sm font-medium text-gray-400">已拉黑 QQ 用户 ({formData.blacklistedQQs.length})</div>
            {formData.blacklistedQQs.length === 0 ? (
              <div className="p-8 text-center text-gray-400">无黑名单记录</div>
            ) : (
              <ul className="divide-y divide-white/5">
                {formData.blacklistedQQs.map((qq) => (
                  <li key={qq} className="flex justify-between items-center p-3 hover:bg-white/5 transition-colors">
                    <span className="font-mono text-white">{qq}</span>
                    <button
                      onClick={() => onRemoveBlacklist(qq)}
                      disabled={actionLoading.blacklist}
                      className="text-gray-400 hover:text-red-400 text-sm flex items-center gap-1 px-2 py-1 hover:bg-white/5 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      移除
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default PermissionsTab;
