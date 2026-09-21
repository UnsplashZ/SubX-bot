import GlassModal from '../../../components/GlassModal';
import { Button } from '../../../components/ui';

const AddSubscriptionModal = ({
  isOpen,
  onClose,
  subForm,
  setSubForm,
  subTypes,
  onAddSubscription
}) => {
  return (
    <GlassModal
      isOpen={isOpen}
      onClose={onClose}
      title="添加订阅"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button variant="primary" onClick={onAddSubscription}>
            添加
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="block text-sm text-[var(--muted)] mb-1">类型</label>
          <select
            value={subForm.type}
            onChange={(e) => setSubForm({ ...subForm, type: e.target.value })}
            className="field-control w-full px-3 py-2"
          >
            {subTypes.map((type) => (
              <option key={type.value} value={type.value}>
                {type.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm text-[var(--muted)] mb-1">值 / ID (UID)</label>
          <input
            type="text"
            value={subForm.value}
            onChange={(e) => setSubForm({ ...subForm, value: e.target.value })}
            placeholder={subForm.type === 'user' ? '请输入用户UID' : '请输入SSID'}
            className="field-control w-full px-3 py-2"
          />
        </div>
      </div>
    </GlassModal>
  );
};

export default AddSubscriptionModal;
