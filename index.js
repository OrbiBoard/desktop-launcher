module.exports = {
  name: '桌面启动台',
  init: (api) => {
    console.log('Desktop Launcher plugin initialized');
    
    // Register global functions for other plugins/components to call
    // Note: To be called via 'call-plugin', they must be in 'functions' export or registered via api.
  },
  functions: {
    getDiskList: async () => {
      return new Promise((resolve) => {
        const { exec } = require('child_process');
        // Use PowerShell to get logical disks with more details and JSON output
        // DriveType: 2 = Removable, 3 = Fixed. We might want Removable (2) for U-disks.
        // However, some USB drives might show as Fixed (3) depending on drivers.
        // Let's get both and filter in frontend or here?
        // Let's just get Type 2 (Removable) first as requested for U-Disk.
        // Also include Type 3 (Fixed) if it's not C:? No, usually U-disks are Type 2.
        // Let's fetch Type 2 and Type 3, but filter out system drive?
        // Safe bet: DriveType 2 is Removable.
        const ps = `Get-CimInstance Win32_LogicalDisk | Where-Object { $_.DriveType -eq 2 } | Select-Object DeviceID, VolumeName, FreeSpace, Size, DriveType | ConvertTo-Json -Compress`;
        
        exec(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${ps.replace(/"/g, '\\"')}"`, { encoding: 'utf8' }, (err, stdout) => {
            if (err) {
                console.error('getDiskList error:', err);
                resolve({ ok: false, error: err.message });
                return;
            }
            try {
                // If no disks found, stdout might be empty or null
                if (!stdout || !stdout.trim()) {
                    resolve({ ok: true, disks: [] });
                    return;
                }
                
                let data;
                try {
                    data = JSON.parse(stdout);
                } catch (parseErr) {
                    // Sometimes PowerShell returns a list of objects not wrapped in array if single item?
                    // ConvertTo-Json usually handles it, but let's be safe.
                    console.error('JSON Parse error:', parseErr, stdout);
                    resolve({ ok: true, disks: [] });
                    return;
                }

                if (!Array.isArray(data)) data = [data]; // Single item returns object

                const result = data.map(d => ({
                    path: d.DeviceID, // "E:"
                    name: d.VolumeName || '可移动磁盘',
                    free: d.FreeSpace,
                    size: d.Size,
                    isRemovable: d.DriveType === 2
                }));
                resolve({ ok: true, disks: result });
            } catch(e) {
                console.error('Process error:', e);
                resolve({ ok: true, disks: [] });
            }
        });
      });
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
