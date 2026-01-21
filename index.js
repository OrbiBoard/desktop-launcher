module.exports = {
  name: '桌面启动台',
  init: (api) => {
    console.log('Desktop Launcher plugin initialized');
    
    // Register global functions for other plugins/components to call
    // Note: To be called via 'call-plugin', they must be in 'functions' export or registered via api.
  },
  functions: {
    getDiskList: async () => {
      try {
        const drivelist = require('drivelist');
        // check-disk-space might be esm or commonjs. robust require:
        let checkDiskSpace = require('check-disk-space');
        if (checkDiskSpace.default) checkDiskSpace = checkDiskSpace.default;

        const drives = await drivelist.list();
        const result = [];
        
        for (const drive of drives) {
            // Filter: Removable OR (USB and NOT System)
            const isUDisk = drive.isRemovable || (drive.isUSB && !drive.isSystem);
            
            if (isUDisk && drive.mountpoints && drive.mountpoints.length > 0) {
                for (const mp of drive.mountpoints) {
                    let free = 0;
                    let size = 0;
                    
                    try {
                        const space = await checkDiskSpace(mp.path);
                        free = space.free;
                        size = space.size;
                    } catch (err) {
                        // Fallback
                        size = drive.size; 
                    }

                    result.push({
                        path: mp.path,
                        name: mp.label || drive.description || drive.displayName || '可移动磁盘',
                        free: free,
                        size: size,
                        isRemovable: true
                    });
                }
            }
        }
        
        return { ok: true, disks: result };
      } catch (e) {
        console.error('getDiskList error:', e);
        return { ok: false, error: e.message };
      }
    },
    ejectDisk: async (drivePath) => {
        // drivePath e.g. "E:"
        return new Promise((resolve) => {
            const { exec } = require('child_process');
            // PowerShell Eject
            const ps = `(New-Object -comObject Shell.Application).Namespace(17).ParseName("${drivePath}").InvokeVerb("Eject")`;
            exec(`powershell -NoProfile -Command "${ps.replace(/"/g, '\\"')}"`, (err) => {
                if (err) resolve({ ok: false, error: err.message });
                else resolve({ ok: true });
            });
        });
    },
    openSettings: () => {
      const { BrowserWindow } = require('electron');
      const path = require('path');
      
      // Singleton check
      if (global.desktopLauncherSettingsWin && !global.desktopLauncherSettingsWin.isDestroyed()) {
          global.desktopLauncherSettingsWin.show();
          global.desktopLauncherSettingsWin.focus();
          return { ok: true };
      }

      let win = new BrowserWindow({
        width: 860,
        height: 640,
        title: '启动台设置',
        webPreferences: {
          nodeIntegration: true,
          contextIsolation: false
        },
        autoHideMenuBar: true,
        backgroundColor: '#121212',
        frame: false, // Frameless
        show: false
      });
      
      global.desktopLauncherSettingsWin = win;
      
      win.loadFile(path.join(__dirname, 'settings.html'));
      
      win.once('ready-to-show', () => {
          win.show();
      });

      win.on('closed', () => {
        win = null;
        global.desktopLauncherSettingsWin = null;
      });
      
      return { ok: true };
    },
    getFileIconDataUrl: async (p) => {
        try {
          const { app } = require('electron');
          const { execFileSync } = require('child_process');
          
          const fp = String(p||''); if (!fp) return '';
          let usePath = fp;
          
          // Resolve shortcut if necessary
          try {
             if (String(fp).toLowerCase().endsWith('.lnk')) {
                const cmd = `(New-Object -COM WScript.Shell).CreateShortcut('${fp.replace(/'/g, "''")}').TargetPath`;
                const out = execFileSync('powershell', ['-NoProfile','-ExecutionPolicy','Bypass','-Command', cmd], { encoding: 'utf8' });
                if (out && out.trim()) usePath = out.trim();
             }
          } catch (e) {}
          
          // Get native icon from Electron
          const img = await app.getFileIcon(usePath, { size: 'large' });
          
          if (!img || img.isEmpty()) return '';
          return img.toDataURL();
        } catch (e) { return ''; }
    }
  }
};
