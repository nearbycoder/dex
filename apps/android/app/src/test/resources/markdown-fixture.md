# Heading 1
## Heading 2
### Heading 3
#### Heading 4
##### Heading 5
###### Heading 6

A paragraph with **bold**, *italic*, ***bold and italic***, ~~strikethrough~~, ~single tilde~, and `inline code`.
A soft line break joins this line to the one before, and a hard one ends this line  
here, and a backslash one ends this\
one too.

Escapes stay literal: \*not italic\*, \`not code\`, \# not a heading, and 2 \* 3. Entities: &copy; &amp; &lt;tag&gt; &#8212; &nbsp;done.
Words with underscores stay plain: snake_case_name and __init__ and file_name.txt, but _this_ is italic and in**side**words is bold.

A very long line with **bold** and `code` and a [link](https://example.com/a/very/long/path/that/keeps/going/and/going) and more words that keep going so the line has to wrap several times on a phone screen, with *italic* near the end and ~~a strike~~ at the very end.

- Bullet one
- Bullet two with **bold**
  - Nested bullet
    - Nested twice
- Bullet three

1. First
2. Second
   1. Nested ordered
   2. Another
3. Third
   - Mixed bullet under ordered

A list can start anywhere:

5. Starts at five
6. Six

A loose list:

- A loose item with two paragraphs.

  Its second paragraph.

- An item with code:

  ```sh
  echo hi
  ```

Tasks:

- [ ] Task to do
- [x] Task done
- [ ] Task with `code`

> A quote with **bold**.
>
> > A nested quote.
>
> Back in the first quote.

```kotlin
fun main() {
    println("A fenced block with a language label and a line long enough that it has to scroll sideways on a phone screen")
}
```

```
No language here.
```

    An indented code block.
    Second line.

| Left | Center | Right | Code |
|:-----|:------:|------:|------|
| a | **b** | 1 | `x = 1` |
| a longer cell with *italic* | [link](https://example.com) | 22 | `y` |
| ~~gone~~ | c | 333 | none |

| Wide | table | with | many | columns | that | will | not | fit | on | a | phone | screen |
|------|-------|------|------|---------|------|------|-----|-----|----|---|-------|--------|
| one | two | three | four | five | six | seven | eight | nine | ten | eleven | twelve | thirteen |

Links: [inline](https://example.com), [reference][ref], [collapsed][], <https://autolink.example.com>, a bare https://bare.example.com/path, www.example.org, and mail@example.com.

[ref]: https://example.com/ref
[collapsed]: https://example.com/collapsed

An image from elsewhere: ![a cat](https://example.com/cat.png)

---

***

A footnote reference[^1] and another[^note].

[^1]: The first footnote.
[^note]: A named footnote with **bold**.

Inline HTML stays text: <b>not bold</b> and <br> here.

<div>An HTML block</div>

Streaming leftovers: an unclosed **bold and an unclosed `code
