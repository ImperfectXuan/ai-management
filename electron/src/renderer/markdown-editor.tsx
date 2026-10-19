// electron/src/renderer/markdown-editor.tsx
// Markdown-native WYSIWYG 编辑器：正文在 Milkdown 中编辑，onChange 始终产出 Markdown。
import React, { useEffect, useRef } from 'react';
import { Milkdown, MilkdownProvider, useEditor } from '@milkdown/react';
import { Editor, defaultValueCtx, editorViewCtx, editorViewOptionsCtx, rootCtx, serializerCtx } from '@milkdown/kit/core';
import { commonmark } from '@milkdown/kit/preset/commonmark';
import { gfm } from '@milkdown/kit/preset/gfm';
import { history } from '@milkdown/kit/plugin/history';
import { listener, listenerCtx } from '@milkdown/kit/plugin/listener';

export interface BodyEditorHandle {
  /** 同步读取编辑器当前 doc 并序列化为 Markdown，绕过监听器的防抖窗口。 */
  flush: () => string;
}

export interface BodyEditorProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  onReady?: (handle: BodyEditorHandle) => void;
}

function MilkdownBodyEditor({ value, onChange, disabled = false, onReady }: BodyEditorProps) {
  // 编辑器实例只创建一次；回调与禁用状态走 ref，避免重挂载丢失光标与撤销栈。
  const onChangeRef = useRef(onChange);
  const disabledRef = useRef(disabled);
  const onReadyRef = useRef(onReady);
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);
  useEffect(() => { disabledRef.current = disabled; }, [disabled]);
  useEffect(() => { onReadyRef.current = onReady; }, [onReady]);

  const { get } = useEditor((root) => Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, root);
      ctx.set(defaultValueCtx, value);
      ctx.set(editorViewOptionsCtx, { editable: () => !disabledRef.current });
      ctx.get(listenerCtx).markdownUpdated((_ctx, markdown) => {
        if (!disabledRef.current) onChangeRef.current(markdown);
      });
    })
    .use(commonmark)
    .use(gfm)
    .use(history)
    .use(listener), []);

  useEffect(() => {
    onReadyRef.current?.({
      flush: () => {
        const editor = get();
        if (!editor) return value;
        return editor.action((ctx) => ctx.get(serializerCtx)(ctx.get(editorViewCtx).state.doc));
      },
    });
  }, [get, value]);

  return <Milkdown />;
}

export function RuleMarkdownEditor(props: BodyEditorProps) {
  return <MilkdownProvider><MilkdownBodyEditor {...props} /></MilkdownProvider>;
}
