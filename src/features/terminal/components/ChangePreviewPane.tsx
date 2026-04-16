import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ChevronDownIcon, CloseIcon } from '../../../shared/ui/icons'
import type {
  ChangePreviewFile,
  ChangePreviewFileStatus,
  ChangePreviewSnapshot,
  DiffLine,
} from '../types'

const EMPTY_FILES: ChangePreviewFile[] = []

interface ChangePreviewPaneProps {
  error: string | null
  isStarting: boolean
  onClose: () => void
  snapshot: ChangePreviewSnapshot | null
}

export function ChangePreviewPane({
  error,
  isStarting,
  onClose,
  snapshot,
}: ChangePreviewPaneProps) {
  const { t } = useTranslation()
  const files = useMemo(() => snapshot?.files ?? EMPTY_FILES, [snapshot])
  const [isFileMenuOpen, setIsFileMenuOpen] = useState(false)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const selectorRef = useRef<HTMLDivElement | null>(null)
  const selectedFile = useMemo(
    () => files.find((file) => file.path === selectedPath) ?? files[0] ?? null,
    [files, selectedPath],
  )
  const totals = useMemo(
    () =>
      files.reduce(
        (currentTotals, file) => ({
          additions: currentTotals.additions + file.additions,
          deletions: currentTotals.deletions + file.deletions,
        }),
        { additions: 0, deletions: 0 },
      ),
    [files],
  )

  useEffect(() => {
    if (files.length === 0) {
      setSelectedPath(null)
      setIsFileMenuOpen(false)
      return
    }

    if (!selectedPath || !files.some((file) => file.path === selectedPath)) {
      setSelectedPath(files[0].path)
    }
  }, [files, selectedPath])

  useEffect(() => {
    if (!isFileMenuOpen) {
      return
    }

    function handlePointerDown(event: PointerEvent) {
      if (
        selectorRef.current &&
        event.target instanceof Node &&
        !selectorRef.current.contains(event.target)
      ) {
        setIsFileMenuOpen(false)
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsFileMenuOpen(false)
      }
    }

    window.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isFileMenuOpen])

  return (
    <aside className="flex h-full min-h-0 w-full max-w-full flex-col overflow-hidden bg-[#070707]">
      <header className="shrink-0 border-b border-white/[0.06] bg-[#090909] px-3 py-2">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[0.78rem] font-medium text-slate-100">
              {t('terminal.preview')}
            </div>
            <div className="mt-0.5 truncate text-[10px] text-slate-500">
              {isStarting
                ? t('preview.starting')
                : t('preview.filesModified', { count: files.length })}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <div className="flex items-center gap-2 text-[10px]">
              <span className="text-emerald-300">+{totals.additions}</span>
              <span className="text-rose-300">-{totals.deletions}</span>
            </div>

            <button
              aria-label={t('preview.close')}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-transparent text-slate-500 transition hover:border-white/[0.08] hover:bg-white/[0.05] hover:text-white"
              onClick={onClose}
              type="button"
            >
              <CloseIcon size={13} />
            </button>
          </div>
        </div>

        {files.length > 0 ? (
          <div className="relative mt-2" ref={selectorRef}>
            <button
              aria-expanded={isFileMenuOpen}
              className="flex h-9 w-full min-w-0 items-center gap-2 rounded-md border border-white/[0.07] bg-white/[0.025] px-2.5 text-left text-[0.74rem] text-slate-200 hover:border-white/[0.12] hover:bg-white/[0.045]"
              onClick={() => setIsFileMenuOpen((currentValue) => !currentValue)}
              type="button"
            >
              {selectedFile ? <StatusDot status={selectedFile.status} /> : null}
              <span className="min-w-0 flex-1 truncate" title={selectedFile?.path}>
                {selectedFile?.path ?? t('preview.selectFile')}
              </span>
              {selectedFile ? (
                <span className="shrink-0 text-[10px] text-emerald-300">
                  +{selectedFile.additions}
                </span>
              ) : null}
              {selectedFile ? (
                <span className="shrink-0 text-[10px] text-rose-300">
                  -{selectedFile.deletions}
                </span>
              ) : null}
              <ChevronDownIcon
                className={`shrink-0 text-slate-500 ${isFileMenuOpen ? 'rotate-180' : ''}`}
                size={13}
              />
            </button>

            {isFileMenuOpen ? (
              <div className="absolute left-0 right-0 top-[calc(100%+0.35rem)] z-20 max-h-56 overflow-auto rounded-md border border-white/[0.08] bg-[#111111] p-1.5 shadow-[0_18px_42px_rgba(0,0,0,0.42)]">
                {files.map((file) => (
                  <button
                    className={`flex h-8 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-[0.72rem] ${
                      selectedFile?.path === file.path
                        ? 'bg-white/[0.075] text-white'
                        : 'text-slate-400 hover:bg-white/[0.045] hover:text-slate-100'
                    }`}
                    key={file.path}
                    onClick={() => {
                      setSelectedPath(file.path)
                      setIsFileMenuOpen(false)
                    }}
                    type="button"
                  >
                    <StatusDot status={file.status} />
                    <span className="min-w-0 flex-1 truncate" title={file.path}>
                      {file.path}
                    </span>
                    <span className="shrink-0 text-[10px] text-emerald-300">
                      +{file.additions}
                    </span>
                    <span className="shrink-0 text-[10px] text-rose-300">
                      -{file.deletions}
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        {error ? (
          <div className="mt-2 rounded-md border border-rose-400/18 bg-rose-400/[0.08] px-2 py-1.5 text-[0.72rem] text-rose-100">
            {error}
          </div>
        ) : null}
      </header>

      <div className="min-h-0 flex-1 overflow-hidden bg-[#050505]">
        {files.length > 0 && selectedFile ? (
          <FileDiff file={selectedFile} />
        ) : (
          <div className="flex h-full items-center justify-center px-5 text-center text-sm text-slate-500">
            {t('preview.empty')}
          </div>
        )}
      </div>
    </aside>
  )
}

function FileDiff({ file }: { file: ChangePreviewFile }) {
  const { t } = useTranslation()

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="shrink-0 border-b border-white/[0.06] bg-[#050505]/95 px-3 py-2">
        <div className="truncate text-[0.76rem] font-medium text-slate-100" title={file.path}>
          {file.path}
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-[10px] text-slate-500">
          <span>{getStatusLabel(file.status, t)}</span>
          {file.isBinary ? <span>{t('preview.binary')}</span> : null}
          {file.isTooLarge ? <span>{t('preview.largeFile')}</span> : null}
        </div>
      </div>

      {file.diff.length > 0 ? (
        <div className="min-h-0 flex-1 overflow-auto font-mono text-[11px] leading-5">
          {file.diff.map((hunk, hunkIndex) => (
            <div className="min-w-full" key={`${file.path}:${hunkIndex}`}>
              <div className="min-w-max border-y border-blue-400/10 bg-blue-400/[0.06] px-3 py-1 text-blue-200">
                @@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@
              </div>
              {hunk.lines.map((line, lineIndex) => (
                <DiffRow
                  key={`${file.path}:${hunkIndex}:${lineIndex}`}
                  line={line}
                />
              ))}
            </div>
          ))}
        </div>
      ) : (
        <div className="px-4 py-5 text-sm text-slate-500">
          {t('preview.fileContentUnavailable')}
        </div>
      )}
    </div>
  )
}

function DiffRow({ line }: { line: DiffLine }) {
  const className = {
    context: 'bg-transparent text-slate-400',
    add: 'bg-emerald-400/[0.08] text-emerald-100',
    delete: 'bg-rose-400/[0.08] text-rose-100',
  }[line.kind]
  const marker = {
    context: ' ',
    add: '+',
    delete: '-',
  }[line.kind]

  return (
    <div
      className={`grid min-w-full grid-cols-[2.35rem_2.35rem_1rem_minmax(18rem,1fr)] ${className}`}
    >
      <span className="select-none border-r border-white/[0.04] px-1.5 text-right text-slate-600">
        {line.oldLine ?? ''}
      </span>
      <span className="select-none border-r border-white/[0.04] px-1.5 text-right text-slate-600">
        {line.newLine ?? ''}
      </span>
      <span className="select-none px-1 text-slate-500">{marker}</span>
      <code className="min-w-max whitespace-pre px-1.5">{line.text || ' '}</code>
    </div>
  )
}

function StatusDot({ status }: { status: ChangePreviewFileStatus }) {
  const className = {
    added: 'bg-emerald-400',
    modified: 'bg-amber-300',
    deleted: 'bg-rose-400',
  }[status]

  return <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${className}`} />
}

function getStatusLabel(status: ChangePreviewFileStatus, t: (key: string) => string) {
  switch (status) {
    case 'added':
      return t('preview.status.added')
    case 'modified':
      return t('preview.status.modified')
    case 'deleted':
      return t('preview.status.deleted')
  }
}
