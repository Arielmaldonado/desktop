import * as React from 'react'
import * as CodeMirror from 'codemirror'
import {
  IAutocompletionProvider,
  UserAutocompletionProvider,
} from '../autocompletion'

interface IAuthorInputProps {
  /**
   * An optional class name for the wrapper element around the
   * author input component
   */
  readonly className?: string
  // tslint:disable-next-line:react-unused-props-and-state
  readonly autocompletionProviders: ReadonlyArray<IAutocompletionProvider<any>>
}

interface IAuthorInputState {}

function previousPosition(doc: CodeMirror.Doc, pos: CodeMirror.Position) {
  return doc.posFromIndex(doc.indexFromPos(pos) - 1)
}

function nextPosition(doc: CodeMirror.Doc, pos: CodeMirror.Position) {
  return doc.posFromIndex(doc.indexFromPos(pos) + 1)
}

function posIsInsideMarkedText(doc: CodeMirror.Doc, pos: CodeMirror.Position) {
  const marks = (doc.findMarksAt(pos) as any) as ActualTextMarker[]
  const ix = doc.indexFromPos(pos)

  for (const mark of marks) {
    const markPos = mark.find()
    let from = doc.indexFromPos(markPos.from)
    let to = doc.indexFromPos(markPos.to)

    if (ix > from && ix < to) {
      return true
    }
  }

  return false
}

function isMarkOrWhitespace(doc: CodeMirror.Doc, pos: CodeMirror.Position) {
  const line = doc.getLine(pos.line)
  if (/\s/.test(line.charAt(pos.ch))) {
    return true
  }

  return posIsInsideMarkedText(doc, pos)
}

function getHintRangeFromCursor(
  doc: CodeMirror.Doc,
  cursor: CodeMirror.Position
) {
  let from = cursor

  while (!isMarkOrWhitespace(doc, previousPosition(doc, from))) {
    from = previousPosition(doc, from)
  }

  let to = cursor

  while (!isMarkOrWhitespace(doc, nextPosition(doc, to))) {
    to = nextPosition(doc, to)
  }

  return { from, to }
}

// The types for CodeMirror.TextMarker is all wrong, this is what it
// actually looks like
interface ActualTextMarker extends CodeMirror.TextMarkerOptions {
  /** Remove the mark. */
  clear(): void

  /**
   * Returns a {from, to} object (both holding document positions), indicating
   * the current position of the marked range, or undefined if the marker is
   * no longer in the document.
   */
  find(): {
    from: CodeMirror.Position
    to: CodeMirror.Position
  }

  changed(): void
}

function renderUserAutocompleteItem(elem: HTMLElement, self: any, data: any) {
  const user = document.createElement('div')
  user.className = 'user'

  const username = document.createElement('span')
  username.className = 'username'
  username.innerText = data.username

  const name = document.createElement('span')
  name.className = 'name'
  name.innerText = data.name

  user.appendChild(username)
  user.appendChild(name)

  elem.appendChild(user)
}

function applyCompletion(doc: CodeMirror.Doc, data: any, completion: any) {
  console.log(`applyCompletion`, data, completion)

  const from: CodeMirror.Position = completion.from || data.from
  const to: CodeMirror.Position = completion.to || data.to
  const text: string = completion.text

  doc.replaceRange(text, from, to, 'complete')

  const end = doc.posFromIndex(doc.indexFromPos(from) + text.length)

  return markRangeAsHandle(doc, from, end, text)
}

function markRangeAsHandle(
  doc: CodeMirror.Doc,
  from: CodeMirror.Position,
  to: CodeMirror.Position,
  text?: string
) {
  if (text === undefined) {
    text = doc.getRange(from, to)
  }

  const elem = document.createElement('span')
  elem.classList.add('handle')
  elem.innerText = text

  return doc.markText(from, to, {
    atomic: true,
    className: 'handle',
    readOnly: false,
    replacedWith: elem,
    handleMouseEvents: true,
  })
}

export class AuthorInput extends React.Component<
  IAuthorInputProps,
  IAuthorInputState
> {
  private editor: CodeMirror.Editor | null = null
  private readonly resizeObserver: ResizeObserver
  private resizeDebounceId: number | null = null
  private hintActive: boolean = false
  private label: ActualTextMarker | null = null
  private placeholder: ActualTextMarker | null = null

  public constructor(props: IAuthorInputProps) {
    super(props)

    this.resizeObserver = new ResizeObserver(entries => {
      if (entries.length >= 1 && this.editor) {
        if (this.resizeDebounceId !== null) {
          cancelAnimationFrame(this.resizeDebounceId)
          this.resizeDebounceId = null
        }
        requestAnimationFrame(this.onResized)
      }
    })

    this.state = {}
  }

  private onResized = () => {
    this.resizeDebounceId = null
    if (this.editor) {
      this.editor.refresh()
    }
  }

  private onContainerRef = (elem: HTMLDivElement) => {
    this.editor = elem ? this.initializeCodeMirror(elem) : null

    if (elem) {
      this.resizeObserver.observe(elem)
    } else {
      this.resizeObserver.disconnect()
    }
  }

  private appendTextMarker(
    cm: CodeMirror.Editor,
    text: string,
    options: CodeMirror.TextMarkerOptions
  ): ActualTextMarker {
    const doc = cm.getDoc()
    const from = doc.posFromIndex(Infinity)

    doc.replaceRange(text, from)
    const to = doc.posFromIndex(Infinity)

    return (doc.markText(from, to, options) as any) as ActualTextMarker
  }

  private initializeCodeMirror(host: HTMLDivElement) {
    const CodeMirrorOptions: CodeMirror.EditorConfiguration & {
      hintOptions: any
    } = {
      mode: null,
      lineWrapping: true,
      extraKeys: {
        Tab: false,
        'Shift-Tab': false,
        'Ctrl-Space': 'autocomplete',
      },
      hintOptions: {
        completeOnSingleClick: true,
        completeSingle: false,
        closeOnUnfocus: true,
        closeCharacters: /\s/,
        hint: async (cm: CodeMirror.Editor) => {
          const doc = cm.getDoc()
          const cursor = doc.getCursor() as Readonly<CodeMirror.Position>

          const { from, to } = getHintRangeFromCursor(doc, cursor)

          var word = doc.getRange(from, to)

          const provider = this.props.autocompletionProviders.find(
            p => p.kind === 'user'
          )

          if (provider && provider instanceof UserAutocompletionProvider) {
            const needle = word.replace(/^@/, '')
            const hits = await provider.getAutocompletionItems(needle)

            return {
              list: hits.map(h => ({
                text: `@${h.username}`,
                username: h.username,
                name: h.name,
                render: renderUserAutocompleteItem,
                className: 'autocompletion-item',
                hint: applyCompletion,
              })),
              from,
              to,
            }
          }

          return { list: [], from, to }
        },
      },
    }

    const cm = CodeMirror(host, CodeMirrorOptions)

    this.label = this.appendTextMarker(cm, 'Co-Authors ', {
      atomic: true,
      inclusiveLeft: true,
      className: 'label',
      readOnly: true,
    })

    this.placeholder = this.appendTextMarker(cm, '@username', {
      atomic: true,
      inclusiveRight: true,
      className: 'placeholder',
      readOnly: true,
    })

    cm.on('startCompletion', () => {
      this.hintActive = true
      console.log('startCompletion')
    })

    cm.on('endCompletion', () => {
      this.hintActive = false
      console.log('endCompletion')
    })

    cm.on('cursorActivity', () => {
      if (this.label && this.placeholder) {
        const labelRange = this.label.find()
        const placeholderRange = this.placeholder.find()

        const doc = cm.getDoc()

        const collapse =
          doc.indexFromPos(labelRange.to) !==
          doc.indexFromPos(placeholderRange.from)

        if (this.placeholder.collapsed !== collapse) {
          this.placeholder.collapsed = collapse
          this.placeholder.changed()
        }
      }
    })

    cm.on('changes', () => {
      if (!this.hintActive) {
        const doc = cm.getDoc()

        if (doc.somethingSelected()) {
          return
        }

        const cursor = doc.getCursor()
        const previousPos = previousPosition(doc, cursor)

        if (posIsInsideMarkedText(doc, previousPos)) {
          return
        }

        const char = doc.getRange(previousPos, cursor)

        if (char === '@') {
          ;(cm as any).showHint()
        }
      }
    })

    return cm
  }

  public render() {
    return <div className={this.props.className} ref={this.onContainerRef} />
  }
}
