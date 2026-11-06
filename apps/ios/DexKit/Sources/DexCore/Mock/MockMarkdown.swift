import Foundation

/// One reply with every piece of Markdown the web renders (GFM, as react-markdown with remark-gfm does): the renderer's
/// test fixture, and what the mock agent answers to a message that says "markdown".
public enum MockMarkdown {
    public static let fixture = ##"""
    # Heading 1
    ## Heading 2
    ### Heading 3
    #### Heading 4
    ##### Heading 5
    ###### Heading 6

    A paragraph with **bold**, *italic*, ***bold and italic***, ~~struck~~, `inline code`, and **bold with `code` inside**.
    Soft line breaks join lines,\
    and a backslash (or two trailing spaces) makes a hard break.

    Words like snake_case_names and my_file_v2.py stay as written. Escapes: \*not italic\*, \`not code\`, \# not a heading. Entities: &amp; &copy; &lt;b&gt; &#35;. Dashes stay put: --force and "straight quotes".

    Links: [inline](https://example.com), [reference][docs], <https://example.com/angle>, bare https://example.com/path_with_underscores?q=1. and www.example.com, mail someone@example.com.

    [docs]: https://example.com/docs "The docs"

    A very long line that goes on and on to check wrapping: https://example.com/a/very/long/path/that/keeps/going/and/going/without/any/spaces/at/all/so/it/must/break/somewhere and **bold** at its end.

    - Unordered item
    - Item with a nested list
      - Nested item
        - Deeper item
    - Item with two paragraphs

      Its second paragraph.
    - Item with code:

      ```sh
      npm run deploy
      ```

    1. First
    2. Second
       - Mixed: a bullet inside a number
    3. Third

    A list can start anywhere:

    9. Nine
    10. Ten

    - [ ] A task to do
    - [x] A task done

    > A quote with **bold**.
    >
    > > A nested quote.

    ```swift
    struct MarkdownView: View {
        let text: String
        var body: some View { Text(text) } // a long line that runs past the edge of a phone screen to show it scrolling sideways
    }
    ```

        indented code block
        second line

    | Left | Center | Right |
    | :--- | :----: | ----: |
    | `code` | **bold** | 1 |
    | [link](https://example.com) | *italic* | 22 |
    | a much longer cell that has to wrap onto more than one line | x | 333 |

    | A | wide | table | with | many | columns | that | scrolls | sideways | inside | its | frame |
    | - | ---- | ----- | ---- | ---- | ------- | ---- | ------- | -------- | ------ | --- | ----- |
    | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 |

    ---

    An image from another site: ![a chart](https://example.com/chart.png). A video: https://www.youtube.com/watch?v=dQw4w9WgXcQ

    Raw HTML shows as text: <b>not bold</b>.

    <div>A block of HTML</div>

    A footnote reference[^note] and another[^2].

    [^note]: The footnote's text, with **bold**.
    [^2]: https://example.com/source
    """##

    /// A reply cut off partway, as it looks while streaming: an unclosed `**`, a half-written table, an open fence.
    public static let streaming = ##"""
    Here's **the plan so far

    | Step | Owner |
    | ---- | ----- |
    | One | me |
    | Two

    ```ts
    const x = 1
    """##
}
