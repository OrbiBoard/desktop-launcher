// Mock API if not available (dev mode)
if (!window.pluginApi) {
  window.pluginApi = {
    store: {
      get: () => null,
      set: () => {},
      getAll: () => ({}),
      setAll: () => {}
    }
  };
}

// Default Configuration
const DEFAULT_CONFIG = {
  buttons: [
    { label: '计时', icon: 'ri-timer-line', actionType: 'plugin', actionPayload: { pluginId: 'clock-timer', fn: 'openTimer' } },
    { label: 'U盘', icon: 'ri-usb-line', actionType: 'key', actionPayload: { key: 'u-disk' } }
  ],
  apps: [
    { label: '希沃白板 5', icon: 'ri-artboard-line', path: '' },
    { label: '希沃视频展台', icon: 'ri-camera-lens-line', path: '' },
    { label: 'Microsoft Edge', icon: 'ri-ie-line', path: '' }
  ]
};

let config = { ...DEFAULT_CONFIG };
const PLUGIN_ID = 'desktop-launcher';

// Initialize
async function init() {
  const ipcRenderer = require('electron').ipcRenderer;
  
  // Load Config from desktop-launcher scope (using main process helper or plugin API)
  // Since we are in a webview inside desktop-widgets, we can use call-plugin to get data?
  // But pluginApi.store.getAll() returns widget's own config (from desktop-widgets).
  // We want GLOBAL config for desktop-launcher.
  // We can use ipcRenderer to invoke config:plugin:getAll
  
  const load = async () => {
      try {
          const res = await ipcRenderer.invoke('config:plugin:getAll', PLUGIN_ID);
          if (res) {
              if (res.buttons) config.buttons = res.buttons;
              if (res.apps) config.apps = res.apps;
          }
          // If empty, use defaults (and save them?)
          if (!config.buttons.length && !config.apps.length) {
              config.buttons = DEFAULT_CONFIG.buttons;
              config.apps = DEFAULT_CONFIG.apps;
          }
          render();
      } catch (e) {
          console.error('Failed to load launcher config:', e);
      }
  };
  
  await load();

  // Listen for config changes from settings window
  ipcRenderer.send('plugin:event:subscribe', 'desktop-launcher:config-changed');
  ipcRenderer.on('plugin:event', (event, { name, payload }) => {
      if (name === 'desktop-launcher:config-changed') {
          if (payload) {
              config.buttons = payload.buttons || [];
              config.apps = payload.apps || [];
              render();
          }
      }
  });
  
  // Also listen for desktop-widgets config updates (legacy/fallback)
  ipcRenderer.on('config-updated', (event, newConfig) => {
    // If widget-specific config is used to override global defaults?
    // For now, prioritize global config for consistency across launcher instances
  });

  render();

  // Event Listeners
  document.getElementById('btn-dismiss').addEventListener('click', () => {
     // Action: One-click dismiss
     console.log('Dismiss clicked');
     ipcRenderer.invoke('desktop-widgets:call-plugin', { 
        pluginId: 'system-control', 
        fn: 'dismissClass', 
        args: [] 
     }).catch(err => console.log('Dismiss action failed (simulated):', err.message));
  });

  document.getElementById('btn-edit').addEventListener('click', () => {
    // Open Settings Window
    ipcRenderer.invoke('desktop-widgets:call-plugin', {
        pluginId: PLUGIN_ID,
        fn: 'openSettings',
        args: []
    });
  });
  
  // Power Button
  const powerBtn = document.getElementById('btn-power');
  const powerMenu = document.getElementById('power-menu');
  const togglePower = () => {
      if (powerMenu.style.display === 'none') {
          powerMenu.style.display = 'flex';
      } else {
          powerMenu.style.display = 'none';
      }
  };
  if (powerBtn) powerBtn.onclick = togglePower;
  if (document.getElementById('btn-power-2')) document.getElementById('btn-power-2').onclick = togglePower;
  
  document.getElementById('pm-shutdown').onclick = () => {
      ipcRenderer.invoke('desktop-widgets:call-plugin', { pluginId: 'screen-compass', fn: 'performAction', args: [{ actionType: 'power', actionPayload: { op: 'shutdown' } }] });
      powerMenu.style.display = 'none';
  };
  document.getElementById('pm-restart').onclick = () => {
      ipcRenderer.invoke('desktop-widgets:call-plugin', { pluginId: 'screen-compass', fn: 'performAction', args: [{ actionType: 'power', actionPayload: { op: 'restart' } }] });
      powerMenu.style.display = 'none';
  };
  document.getElementById('pm-cancel').onclick = () => { powerMenu.style.display = 'none'; };

  // U-Disk View Logic
  const mainContainer = document.getElementById('main-container');
  const udiskContainer = document.getElementById('udisk-container');
  
  window.openUdiskView = async () => {
      mainContainer.style.display = 'none';
      udiskContainer.style.display = 'flex';
      renderUdiskList();
  };
  
  document.getElementById('btn-udisk-back').onclick = () => {
      udiskContainer.style.display = 'none';
      mainContainer.style.display = 'flex';
  };
  
  document.getElementById('btn-expand').addEventListener('click', () => {
    console.log('Expand clicked');
  });
}

async function renderUdiskList() {
    const list = document.getElementById('udisk-list');
    list.innerHTML = '<div style="color:#888;text-align:center;margin-top:20px;">正在获取设备...</div>';
    
    try {
        const { ipcRenderer } = require('electron');
        // Call main process to get disk list (using desktop-launcher's own function)
        const res = await ipcRenderer.invoke('desktop-widgets:call-plugin', {
            pluginId: PLUGIN_ID,
            fn: 'getDiskList',
            args: []
        });
        
        list.innerHTML = '';
        const disks = (res && res.disks) ? res.disks : [];
        
        if (disks.length === 0) {
            list.innerHTML = '<div style="color:#888;text-align:center;margin-top:20px;">未检测到可移动磁盘</div>';
            return;
        }
        
        disks.forEach(d => {
            const card = document.createElement('div');
            card.className = 'udisk-card';
            
            // Calculate usage
            let percent = 0;
            let usageColorClass = '';
            if (d.size > 0) {
                const used = d.size - d.free;
                percent = Math.floor((used / d.size) * 100);
                if (percent > 90) usageColorClass = 'full';
            }
            
            // Format Size
            const fmtSize = (bytes) => {
                if (bytes > 1024*1024*1024) return (bytes / (1024*1024*1024)).toFixed(1) + ' GB';
                return (bytes / (1024*1024)).toFixed(1) + ' MB';
            };
            
            card.innerHTML = `
                <div class="udisk-progress-bg ${usageColorClass}" style="width: ${percent}%"></div>
                <div class="udisk-info">
                    <i class="ri-u-disk-line udisk-icon"></i>
                    <div class="udisk-text">
                        <div class="udisk-name">${d.name} (${d.path})</div>
                        <div class="udisk-meta">已用 ${fmtSize(d.size - d.free)} / 共 ${fmtSize(d.size)}</div>
                    </div>
                </div>
                <div class="udisk-action">
                    <button class="btn-eject" title="弹出"><i class="ri-eject-line"></i></button>
                </div>
            `;
            
            // Open Drive
            card.onclick = (e) => {
                if (e.target.closest('.btn-eject')) return;
                ipcRenderer.invoke('desktop-widgets:open-path', d.path + '\\');
            };
            
            // Eject
            const btnEject = card.querySelector('.btn-eject');
            btnEject.onclick = async () => {
                btnEject.innerHTML = '<i class="ri-loader-4-line ri-spin"></i>';
                await ipcRenderer.invoke('desktop-widgets:call-plugin', {
                    pluginId: PLUGIN_ID,
                    fn: 'ejectDisk',
                    args: [d.path] // e.g. "E:"
                });
                renderUdiskList(); // Refresh
            };
            
            list.appendChild(card);
        });
        
    } catch(e) {
        list.innerHTML = `<div style="color:red;text-align:center;margin-top:20px;">获取失败: ${e.message}</div>`;
    }
}

function render() {
  renderTools();
  renderApps();
}

function renderTools() {
  const container = document.getElementById('tools-container');
  container.innerHTML = '';

  config.buttons.forEach((btn) => {
    const el = document.createElement('div');
    el.className = 'tool-btn';
    let iconHtml = '';
    const ic = btn.icon || '';
    if (ic.startsWith('data:') || ic.startsWith('http') || ic.includes('/') || ic.includes('\\')) {
        iconHtml = `<img src="${ic}" style="width:24px;height:24px;object-fit:contain;margin-bottom:4px;">`;
    } else {
        iconHtml = `<i class="${ic}"></i>`;
    }
    el.innerHTML = `
      ${iconHtml}
      <span>${btn.label}</span>
    `;
    el.onclick = () => handleAction(btn);
    container.appendChild(el);
  });
}

function renderApps() {
  const container = document.getElementById('apps-container');
  container.innerHTML = '';

  config.apps.forEach((app) => {
    const el = document.createElement('div');
    el.className = 'app-item';
    let iconHtml = '';
    const ic = app.icon || '';
    if (ic.startsWith('data:') || ic.startsWith('http') || ic.includes('/') || ic.includes('\\')) {
        iconHtml = `<img src="${ic}">`;
    } else {
        iconHtml = `<i class="${ic}"></i>`;
    }
    el.innerHTML = `
      <div class="app-icon">
        ${iconHtml}
      </div>
      <div class="app-label" title="${app.label}">${app.label}</div>
    `;
    el.onclick = () => handleAppLaunch(app);
    container.appendChild(el);
  });
}

function handleAction(btn) {
  console.log('Action:', btn);
  const ipcRenderer = require('electron').ipcRenderer;
  if (btn.actionType === 'plugin') {
      const payload = btn.actionPayload || {};
      ipcRenderer.invoke('desktop-widgets:call-plugin', { 
          pluginId: payload.pluginId, 
          fn: payload.fn, 
          args: payload.args || [] 
      }).then(res => {
          if (!res.ok) console.error('Plugin call failed:', res.error);
      });
  } else if (btn.actionType === 'openSettings') {
      ipcRenderer.invoke('desktop-widgets:call-plugin', { 
          pluginId: PLUGIN_ID, 
          fn: 'openSettings', 
          args: [] 
      });
  } else if (btn.actionType === 'udisk') {
      window.openUdiskView();
  } else if (btn.actionType === 'key') {
      console.log('Simulate key:', btn.actionPayload);
      // Legacy support for old u-disk button config
      if (btn.actionPayload && btn.actionPayload.key === 'u-disk') {
          window.openUdiskView();
      }
  } else if (btn.actionType === 'app') {
      if (btn.actionPayload && btn.actionPayload.path) {
          ipcRenderer.invoke('desktop-widgets:open-path', btn.actionPayload.path);
      }
  }
}

function handleAppLaunch(app) {
  console.log('Launch app:', app);
  const ipcRenderer = require('electron').ipcRenderer;
  if (app.path) {
      ipcRenderer.invoke('desktop-widgets:open-path', app.path);
  }
}

init();
