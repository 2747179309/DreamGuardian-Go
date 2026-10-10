cmake_minimum_required(VERSION 3.16)

# The three BOX BSP packages export the same generic bsp_* symbols.  This
# firmware targets BOX-3 only; keeping the other two in the component graph can
# silently bind audio/display calls to the wrong board depending on link order.
# Massage control has been retired from the DreamGuardian runtime.  Keep its
# source tree only as protocol reference, but do not build or initialize BLE.
set(EXCLUDE_COMPONENTS "espressif__esp-box;espressif__esp-box-lite;massage")

include($ENV{IDF_PATH}/tools/cmake/project.cmake)
project(dreamguardian2)

spiffs_create_partition_image(storage spiffs FLASH_IN_PROJECT)
