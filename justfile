set shell := ['zsh', '-eu', '-o', 'pipefail', '-c']

# Build the current checkout, copy it to the NUC Windows Temp directory, and
# stop the installed DSH process tree, then run the normal transactional
# installer. Set DSH_DESKTOP_HOST_ROOT to the already-built Windows host
# payload and NUC_SSH_HOST to override nuc-kep.
install-from-mac-to-nuc:
    scripts/install-from-mac-to-nuc.sh
