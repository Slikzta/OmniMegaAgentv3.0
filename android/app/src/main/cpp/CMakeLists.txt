cmake_minimum_required(VERSION 3.22.1)
project("sierra_local_voice_jni" C CXX)

set(CMAKE_C_STANDARD 11)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Force Release optimization (-O3) even when Gradle runs assembleDebug so on-device
# LLM and Whisper inference run at full native speed on arm64-v8a.
set(CMAKE_BUILD_TYPE Release CACHE STRING "Build type" FORCE)
set(CMAKE_C_FLAGS_DEBUG "-O3 -DNDEBUG")
set(CMAKE_CXX_FLAGS_DEBUG "-O3 -DNDEBUG")
set(CMAKE_C_FLAGS_RELEASE "-O3 -DNDEBUG")
set(CMAKE_CXX_FLAGS_RELEASE "-O3 -DNDEBUG")
set(CMAKE_C_FLAGS_RELWITHDEBINFO "-O3 -DNDEBUG")
set(CMAKE_CXX_FLAGS_RELWITHDEBINFO "-O3 -DNDEBUG")

include(CheckCXXCompilerFlag)
if(CMAKE_SYSTEM_PROCESSOR MATCHES "aarch64|arm64" OR ANDROID_ABI STREQUAL "arm64-v8a")
    check_cxx_compiler_flag("-march=armv8.2-a+dotprod+i8mm" HAS_ARM_DOTPROD_I8MM)
    check_cxx_compiler_flag("-march=armv8.2-a+dotprod" HAS_ARM_DOTPROD)
    if(HAS_ARM_DOTPROD_I8MM)
        set(SIERRA_ARM_ARCH_FLAG "-march=armv8.2-a+dotprod+i8mm")
        set(GGML_CPU_ARM_ARCH "armv8.2-a+dotprod+i8mm" CACHE STRING "ARM arch for ggml" FORCE)
    elseif(HAS_ARM_DOTPROD)
        set(SIERRA_ARM_ARCH_FLAG "-march=armv8.2-a+dotprod")
        set(GGML_CPU_ARM_ARCH "armv8.2-a+dotprod" CACHE STRING "ARM arch for ggml" FORCE)
    else()
        set(SIERRA_ARM_ARCH_FLAG "-march=armv8-a")
        set(GGML_CPU_ARM_ARCH "armv8-a" CACHE STRING "ARM arch for ggml" FORCE)
    endif()
    set(CMAKE_C_FLAGS "${CMAKE_C_FLAGS} -O3 -DNDEBUG ${SIERRA_ARM_ARCH_FLAG} -fno-finite-math-only -funroll-loops")
    set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -O3 -DNDEBUG ${SIERRA_ARM_ARCH_FLAG} -fno-finite-math-only -funroll-loops")
endif()

include(FetchContent)

# Configure shared ggml + llama.cpp + whisper.cpp build options (CPU + ARM NEON/dotprod/i8mm on Android)
set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)
set(GGML_OPENMP OFF CACHE BOOL "" FORCE)
set(GGML_LLAMAFILE OFF CACHE BOOL "" FORCE)
set(GGML_CUDA OFF CACHE BOOL "" FORCE)
set(GGML_METAL OFF CACHE BOOL "" FORCE)
set(GGML_VULKAN OFF CACHE BOOL "" FORCE)
set(GGML_SYCL OFF CACHE BOOL "" FORCE)
set(GGML_KOMPUTE OFF CACHE BOOL "" FORCE)
set(GGML_RPC OFF CACHE BOOL "" FORCE)
set(GGML_CCACHE OFF CACHE BOOL "" FORCE)

set(LLAMA_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_SERVER OFF CACHE BOOL "" FORCE)
set(LLAMA_CURL OFF CACHE BOOL "" FORCE)

set(WHISPER_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(WHISPER_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(WHISPER_BUILD_SERVER OFF CACHE BOOL "" FORCE)
set(WHISPER_CURL OFF CACHE BOOL "" FORCE)
set(WHISPER_SDL2 OFF CACHE BOOL "" FORCE)
set(WHISPER_FFMPEG OFF CACHE BOOL "" FORCE)

# Pinned known-good tags with byte-for-byte identical ggml (2025-01-04 ggml sync):
# - ggerganov/llama.cpp @ b4415
# - ggerganov/whisper.cpp @ v1.7.4
FetchContent_Declare(
    llama_cpp
    GIT_REPOSITORY https://github.com/ggerganov/llama.cpp.git
    GIT_TAG        b4415
    GIT_SHALLOW    TRUE
)

FetchContent_Declare(
    whisper_cpp
    GIT_REPOSITORY https://github.com/ggerganov/whisper.cpp.git
    GIT_TAG        v1.7.4
    GIT_SHALLOW    TRUE
)

# Make llama_cpp available first (defines target `ggml` and target `llama`),
# then whisper_cpp (reuses existing `ggml` target via `if (NOT TARGET ggml)` and defines `whisper`).
FetchContent_MakeAvailable(llama_cpp)
FetchContent_MakeAvailable(whisper_cpp)

add_library(
    sierra_local_voice_jni
    SHARED
    sierra_local_voice_jni.cpp
)

if(CMAKE_SYSTEM_PROCESSOR MATCHES "aarch64|arm64" OR ANDROID_ABI STREQUAL "arm64-v8a")
    target_compile_options(sierra_local_voice_jni PRIVATE -O3 -fno-finite-math-only -funroll-loops ${SIERRA_ARM_ARCH_FLAG})
else()
    target_compile_options(sierra_local_voice_jni PRIVATE -O3 -fno-finite-math-only)
endif()

target_include_directories(
    sierra_local_voice_jni
    PRIVATE
    ${llama_cpp_SOURCE_DIR}/include
    ${llama_cpp_SOURCE_DIR}/ggml/include
    ${whisper_cpp_SOURCE_DIR}/include
)

find_library(log-lib log)
find_library(android-lib android)

target_link_libraries(
    sierra_local_voice_jni
    PRIVATE
    llama
    whisper
    ggml
    ${log-lib}
    ${android-lib}
)
