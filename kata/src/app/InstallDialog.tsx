import { Mark, Wordmark } from '@/brand/Brand';
import { Button, Dialog } from '@/ui/primitives';
import { Icon } from '@/ui/icons';
import { promptInstall, useInstallState } from './install';

export function InstallDialog({ onClose }: { onClose: () => void }) {
  const state = useInstallState();
  return (
    <Dialog open onClose={onClose} title="Install Kata" width={400}>
      <div className="install">
        <div className="install-icon">
          <Mark size={34} />
        </div>
        <Wordmark height={12} />
        <p className="install-lede">
          Kata runs as an app: its own window and launch screen, opens offline, and keeps your accounts on this device.
        </p>
        {state === 'prompt' && (
          <Button
            variant="primary"
            size="lg"
            block
            icon="install"
            onClick={async () => {
              await promptInstall();
              onClose();
            }}
          >
            Install app
          </Button>
        )}
        {state === 'ios' && (
          <ol className="install-steps">
            <li>
              <span className="install-n num">1</span>Tap <strong>Share</strong> <Icon name="upload" size={14} /> in Safari’s toolbar.
            </li>
            <li>
              <span className="install-n num">2</span>Choose <strong>Add to Home Screen</strong>.
            </li>
            <li>
              <span className="install-n num">3</span>Open Kata from your Home Screen.
            </li>
          </ol>
        )}
        {state === 'installed' && <p className="install-lede">Kata is installed on this device.</p>}
        {state === 'unsupported' && (
          <p className="install-lede faint">
            This browser doesn’t offer installation. In Chrome or Edge, use the install icon in the address bar; on iPhone, use Safari.
          </p>
        )}
      </div>
    </Dialog>
  );
}
