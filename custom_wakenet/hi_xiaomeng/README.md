# Custom WakeNet Model: hi xiaomeng

Put the trained ESP-SR WakeNet9 model files for `hi 小梦` in this directory:

- `_MODEL_INFO_`
- `wn9_data`
- `wn9_index`

Do not copy the placeholder files from `managed_components/espressif__esp-sr/model/wakenet_model/wn9_customword` here. In the current ESP-SR package, that placeholder is byte-for-byte identical to `wn9_xiaoaitongxue`, so it is not the DreamGuardian wake word.

After the trained files are available, run:

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\install_custom_wakenet.ps1 -EnableSdkconfig
```

Then rebuild and flash the model partition:

```powershell
idf.py build
idf.py -p COM12 flash
```

The firmware will prefer a model whose name contains `customword` when `CONFIG_SR_WN_WN9_CUSTOMWORD=y` is enabled. If that model is not present, the voice module falls back to `hiesp`.
