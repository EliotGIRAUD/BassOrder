import { useSyncExternalStore } from "react";
import { PushFill } from "./push";
import {
  listWorkJobs,
  shortJobLabel,
  subscribeWork,
  workViewForJob,
  type WorkJob,
} from "./workStatus";

type Props = {
  onOpen: (view: "local" | "spotify") => void;
};

export function BackgroundJobs({ onOpen }: Props) {
  const jobs = useSyncExternalStore(subscribeWork, listWorkJobs, listWorkJobs);

  if (jobs.length === 0) {
    return null;
  }

  return (
    <div className="rail-jobs" aria-label="Tâches en cours">
      {jobs.map((job) => (
        <JobChip key={job.id} job={job} onOpen={onOpen} />
      ))}
    </div>
  );
}

function JobChip({
  job,
  onOpen,
}: {
  job: WorkJob;
  onOpen: (view: "local" | "spotify") => void;
}) {
  const view = workViewForJob(job.id);
  const percent =
    job.total != null && job.total > 0 && job.done != null
      ? Math.min(100, Math.round((job.done / job.total) * 100))
      : null;
  const short = shortJobLabel(job.id, job.label);
  const title = [job.label, job.detail].filter(Boolean).join(" — ");

  return (
    <button
      type="button"
      className="rail-job"
      onClick={() => onOpen(view)}
      title={title}
      aria-label={title}
    >
      <span className="rail-job-ring" aria-hidden>
        <svg viewBox="0 0 36 36">
          <circle className="rail-job-ring-track" cx="18" cy="18" r="14" />
          <circle
            className="rail-job-ring-value"
            cx="18"
            cy="18"
            r="14"
            style={
              percent != null
                ? {
                    strokeDasharray: `${(percent / 100) * 88} 88`,
                  }
                : undefined
            }
            data-indeterminate={percent == null ? "true" : undefined}
          />
        </svg>
        <span className="rail-job-ring-core" />
      </span>
      <span className="rail-job-copy">
        <strong>{short}</strong>
        <em>{percent != null ? `${percent}%` : "…"}</em>
      </span>
      <span
        className={`rail-job-bar${percent == null ? " is-indeterminate" : ""}`}
        aria-hidden
        onClick={(e) => e.stopPropagation()}
      >
        {percent == null ? (
          <i />
        ) : (
          <PushFill value={percent} className="rail-job-push" />
        )}
      </span>
    </button>
  );
}
