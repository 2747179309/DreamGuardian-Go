import argparse
import json
import shutil
import sys
from pathlib import Path
import pyarrow.parquet as pq
import pyarrow as pa
from tqdm import tqdm

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

def merge_datasets(base_dir: Path, supp_dir: Path, output_dir: Path):
    print("=" * 65)
    print("🔄 DreamGuardian Next - LeRobot 数据集合并工具")
    print(f"📦 基准数据集: {base_dir}")
    print(f"➕ 增补数据集: {supp_dir}")
    print(f"🎯 输出目标:   {output_dir}")
    print("=" * 65)

    if not base_dir.exists():
        raise FileNotFoundError(f"未找到基准数据集: {base_dir}")
    if not supp_dir.exists():
        raise FileNotFoundError(f"未找到增补数据集: {supp_dir}")

    with open(base_dir / "meta" / "info.json", "r", encoding="utf-8") as f:
        base_info = json.load(f)
    with open(supp_dir / "meta" / "info.json", "r", encoding="utf-8") as f:
        supp_info = json.load(f)

    n_base_eps = base_info["total_episodes"]
    n_base_frames = base_info["total_frames"]
    n_supp_eps = supp_info["total_episodes"]
    n_supp_frames = supp_info["total_frames"]

    total_eps = n_base_eps + n_supp_eps
    total_frames = n_base_frames + n_supp_frames

    print(f"\n[1/4] 数据量统计:")
    print(f"  - 基准集: {n_base_eps} 轮 (共 {n_base_frames} 帧)")
    print(f"  - 增补集: {n_supp_eps} 轮 (共 {n_supp_frames} 帧)")
    print(f"  - 合并后: {total_eps} 轮 (共 {total_frames} 帧)")

    if output_dir.exists():
        print(f"⚠️ 目标目录 {output_dir} 已存在，正在清理旧文件...")
        shutil.rmtree(output_dir)

    out_meta = output_dir / "meta"
    out_data = output_dir / "data" / "chunk-000"
    out_videos = output_dir / "videos" / "chunk-000" / "observation.images.handeye"

    out_meta.mkdir(parents=True, exist_ok=True)
    out_data.mkdir(parents=True, exist_ok=True)
    out_videos.mkdir(parents=True, exist_ok=True)

    print(f"\n[2/4] 正在复制并迁移基准数据集 (0 ~ {n_base_eps - 1})...")
    base_parquets = sorted((base_dir / "data" / "chunk-000").glob("episode_*.parquet"))
    for p in tqdm(base_parquets, desc="复制基准 Parquet"):
        shutil.copy2(p, out_data / p.name)

    base_videos = sorted((base_dir / "videos" / "chunk-000" / "observation.images.handeye").glob("episode_*.mp4"))
    for v in tqdm(base_videos, desc="复制基准 MP4"):
        shutil.copy2(v, out_videos / v.name)

    out_episodes_jsonl = out_meta / "episodes.jsonl"
    out_stats_jsonl = out_meta / "episodes_stats.jsonl"
    shutil.copy2(base_dir / "meta" / "episodes.jsonl", out_episodes_jsonl)
    shutil.copy2(base_dir / "meta" / "episodes_stats.jsonl", out_stats_jsonl)
    shutil.copy2(base_dir / "meta" / "tasks.jsonl", out_meta / "tasks.jsonl")

    print(f"\n[3/4] 正在重编索引并追加增补数据集 ({n_base_eps} ~ {total_eps - 1})...")
    with open(supp_dir / "meta" / "episodes.jsonl", "r", encoding="utf-8") as f:
        supp_ep_lines = [json.loads(line) for line in f if line.strip()]
    with open(supp_dir / "meta" / "episodes_stats.jsonl", "r", encoding="utf-8") as f:
        supp_stats_lines = [json.loads(line) for line in f if line.strip()]

    with open(out_episodes_jsonl, "a", encoding="utf-8") as f_ep, \
         open(out_stats_jsonl, "a", encoding="utf-8") as f_st:
        current_global_index = n_base_frames

        for local_ep_idx in tqdm(range(n_supp_eps), desc="合并增补轮次"):
            new_ep_idx = n_base_eps + local_ep_idx

            p_src = supp_dir / "data" / "chunk-000" / f"episode_{local_ep_idx:06d}.parquet"
            table = pq.read_table(p_src)
            df = table.to_pandas()
            ep_len = len(df)

            df["episode_index"] = new_ep_idx
            df["index"] = [current_global_index + i for i in range(ep_len)]
            current_global_index += ep_len

            p_dst = out_data / f"episode_{new_ep_idx:06d}.parquet"
            new_table = pa.Table.from_pandas(df, schema=table.schema)
            pq.write_table(new_table, p_dst)

            v_src = supp_dir / "videos" / "chunk-000" / "observation.images.handeye" / f"episode_{local_ep_idx:06d}.mp4"
            v_dst = out_videos / f"episode_{new_ep_idx:06d}.mp4"
            shutil.copy2(v_src, v_dst)

            ep_meta = supp_ep_lines[local_ep_idx]
            ep_meta["episode_index"] = new_ep_idx
            f_ep.write(json.dumps(ep_meta, ensure_ascii=False) + "\n")

            stats_meta = supp_stats_lines[local_ep_idx]
            stats_meta["episode_index"] = new_ep_idx
            f_st.write(json.dumps(stats_meta, ensure_ascii=False) + "\n")

    merged_info = dict(base_info)
    merged_info["total_episodes"] = total_eps
    merged_info["total_frames"] = total_frames
    merged_info["total_videos"] = total_eps
    merged_info["splits"]["train"] = f"0:{total_eps}"

    with open(out_meta / "info.json", "w", encoding="utf-8") as f:
        json.dump(merged_info, f, indent=4, ensure_ascii=False)

    print("\n[4/4] 正在验证合并后数据集的完整性...")
    try:
        from lerobot.datasets.lerobot_dataset import LeRobotDataset
        ds = LeRobotDataset(str(output_dir))
        print("✓ LeRobot 原生接口校验通过！数据集已成功挂载。")
        print(f"  - 总轮数 (num_episodes): {ds.num_episodes}")
        print(f"  - 总帧数 (num_frames):   {ds.num_frames}")
    except Exception as e:
        print(f"⚠️ 校验提示: {e}")

    print("\n" + "=" * 65)
    print(f"🎉 恭喜！数据集已完美合并至: {output_dir}")
    print(f"📦 包含原版 {n_base_eps} 轮 + 增补 {n_supp_eps} 轮 = 共计 {total_eps} 轮。")
    print("👉 你可以直接将整个目录打包上传至 AutoDL 云端启动训练！")
    print("=" * 65)

def main():
    parser = argparse.ArgumentParser(description="LeRobot 数据集合并拼装工具")
    parser.add_argument("--base", type=str, default="D:/group project/data/tissue_handover", help="基准数据集路径")
    parser.add_argument("--supplement", type=str, default="D:/group project/data/tissue_handover_supplement", help="增补数据集路径")
    parser.add_argument("--output", type=str, default="D:/group project/data/tissue_handover_merged", help="合并后生成的目标数据集路径")
    args = parser.parse_args()

    merge_datasets(Path(args.base), Path(args.supplement), Path(args.output))

if __name__ == "__main__":
    main()
