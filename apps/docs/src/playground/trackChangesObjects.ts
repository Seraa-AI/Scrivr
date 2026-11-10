/**
 * Alice's pending changes to images and other blocks, recorded by the track
 * changes engine itself and frozen here with stable ids, so they look and decide
 * exactly as live edits would. What she did:
 *
 * - added an inline image, and removed another;
 * - dragged a floating image to the next paragraph, and nudged another lower on
 *   its page;
 * - added a table and a code block, and removed a horizontal rule;
 * - turned a paragraph into a heading;
 * - moved a whole paragraph below the table.
 *
 * Regenerate by replaying those edits as "alice" with tracking on and replacing
 * ids and times with stable ones.
 */
export const ALICE_OBJECT_CHANGES: unknown[] = [
  {
    "type": "paragraph",
    "attrs": {
      "align": "left",
      "indent": 0,
      "textIndent": 0,
      "fontFamily": null,
      "dataTracked": [
        {
          "id": "demo-object-1",
          "authorID": "alice",
          "reviewedByID": null,
          "createdAt": 1760000000000,
          "updatedAt": 1760000000000,
          "statusUpdateAt": 0,
          "status": "pending",
          "moveNodeId": "demo-object-2",
          "operation": "delete"
        }
      ]
    },
    "content": [
      {
        "type": "text",
        "marks": [
          {
            "type": "trackedDelete",
            "attrs": {
              "dataTracked": {
                "id": "demo-object-3",
                "authorID": "alice",
                "reviewedByID": null,
                "createdAt": 1760000000000,
                "updatedAt": 1760000000000,
                "statusUpdateAt": 0,
                "status": "pending",
                "moveNodeId": "demo-object-2",
                "operation": "delete"
              }
            }
          }
        ],
        "text": "Alice moved this paragraph from here to below the table."
      }
    ]
  },
  {
    "type": "paragraph",
    "attrs": {
      "align": "left",
      "indent": 0,
      "textIndent": 0,
      "fontFamily": null,
      "dataTracked": []
    },
    "content": [
      {
        "type": "text",
        "text": "Alice added an image at the end of this line: "
      },
      {
        "type": "image",
        "attrs": {
          "src": "https://picsum.photos/seed/added/160/110",
          "alt": "added",
          "width": 60,
          "height": 40,
          "dataTracked": [
            {
              "id": "demo-object-4",
              "authorID": "alice",
              "reviewedByID": null,
              "createdAt": 1760000000000,
              "updatedAt": 1760000000000,
              "statusUpdateAt": 0,
              "status": "pending",
              "operation": "insert",
              "creationId": "demo-object-4"
            }
          ],
          "pendingPasteId": null,
          "verticalAlign": "baseline",
          "wrapMode": "inline",
          "positionMode": "move-with-text",
          "xAlign": "left",
          "x": null,
          "yOffset": 0,
          "zIndex": 0,
          "margin": 12,
          "wrappingMode": "inline",
          "floatOffset": {
            "x": 0,
            "y": 0
          }
        }
      }
    ]
  },
  {
    "type": "paragraph",
    "attrs": {
      "align": "left",
      "indent": 0,
      "textIndent": 0,
      "fontFamily": null,
      "dataTracked": []
    },
    "content": [
      {
        "type": "text",
        "text": "Alice removed the image at the end of this line: "
      },
      {
        "type": "image",
        "attrs": {
          "src": "https://picsum.photos/seed/removed/160/110",
          "alt": "removed",
          "width": 60,
          "height": 40,
          "dataTracked": [
            {
              "id": "demo-object-5",
              "authorID": "alice",
              "reviewedByID": null,
              "createdAt": 1760000000000,
              "updatedAt": 1760000000000,
              "statusUpdateAt": 0,
              "status": "pending",
              "operation": "delete"
            }
          ],
          "pendingPasteId": null,
          "verticalAlign": "baseline",
          "wrapMode": "inline",
          "positionMode": "move-with-text",
          "xAlign": "left",
          "x": null,
          "yOffset": 0,
          "zIndex": 0,
          "margin": 12,
          "wrappingMode": "inline",
          "floatOffset": {
            "x": 0,
            "y": 0
          }
        }
      }
    ]
  },
  {
    "type": "paragraph",
    "attrs": {
      "align": "left",
      "indent": 0,
      "textIndent": 0,
      "fontFamily": null,
      "dataTracked": []
    },
    "content": [
      {
        "type": "image",
        "attrs": {
          "src": "https://picsum.photos/seed/dragged/160/110",
          "alt": "dragged",
          "width": 160,
          "height": 110,
          "dataTracked": [
            {
              "id": "demo-object-6",
              "authorID": "alice",
              "reviewedByID": null,
              "createdAt": 1760000000000,
              "updatedAt": 1760000000000,
              "statusUpdateAt": 0,
              "status": "pending",
              "moveNodeId": "demo-object-7",
              "operation": "delete"
            }
          ],
          "pendingPasteId": null,
          "verticalAlign": "baseline",
          "wrapMode": "square",
          "positionMode": "move-with-text",
          "xAlign": "left",
          "x": null,
          "yOffset": 0,
          "zIndex": 0,
          "margin": 12,
          "wrappingMode": "inline",
          "floatOffset": {
            "x": 0,
            "y": 0
          }
        }
      },
      {
        "type": "text",
        "text": "Alice dragged the image beside this paragraph down to the next one."
      }
    ]
  },
  {
    "type": "paragraph",
    "attrs": {
      "align": "left",
      "indent": 0,
      "textIndent": 0,
      "fontFamily": null,
      "dataTracked": []
    },
    "content": [
      {
        "type": "image",
        "attrs": {
          "src": "https://picsum.photos/seed/dragged/160/110",
          "alt": "dragged",
          "width": 160,
          "height": 110,
          "dataTracked": [
            {
              "id": "demo-object-8",
              "authorID": "alice",
              "reviewedByID": null,
              "createdAt": 1760000000000,
              "updatedAt": 1760000000000,
              "statusUpdateAt": 0,
              "status": "pending",
              "moveNodeId": "demo-object-7",
              "operation": "move",
              "dependsOn": [],
              "placementDependsOn": []
            }
          ],
          "pendingPasteId": null,
          "verticalAlign": "baseline",
          "wrapMode": "square",
          "positionMode": "move-with-text",
          "xAlign": "left",
          "x": null,
          "yOffset": 0,
          "zIndex": 0,
          "margin": 12,
          "wrappingMode": "inline",
          "floatOffset": {
            "x": 0,
            "y": 0
          }
        }
      },
      {
        "type": "text",
        "text": "It lands beside this paragraph."
      }
    ]
  },
  {
    "type": "paragraph",
    "attrs": {
      "align": "left",
      "indent": 0,
      "textIndent": 0,
      "fontFamily": null,
      "dataTracked": []
    },
    "content": [
      {
        "type": "image",
        "attrs": {
          "src": "https://picsum.photos/seed/nudged/160/110",
          "alt": "nudged",
          "width": 160,
          "height": 110,
          "dataTracked": [
            {
              "id": "demo-object-9",
              "authorID": "alice",
              "reviewedByID": null,
              "createdAt": 1760000000000,
              "updatedAt": 1760000000000,
              "statusUpdateAt": 0,
              "status": "pending",
              "operation": "set_attrs",
              "oldAttrs": {
                "src": "https://picsum.photos/seed/nudged/160/110",
                "alt": "nudged",
                "width": 160,
                "height": 110,
                "pendingPasteId": null,
                "verticalAlign": "baseline",
                "wrapMode": "square",
                "positionMode": "move-with-text",
                "xAlign": "right",
                "x": null,
                "yOffset": 0,
                "zIndex": 0,
                "margin": 12,
                "wrappingMode": "inline",
                "floatOffset": {
                  "x": 0,
                  "y": 0
                }
              }
            }
          ],
          "pendingPasteId": null,
          "verticalAlign": "baseline",
          "wrapMode": "square",
          "positionMode": "move-with-text",
          "xAlign": "right",
          "x": null,
          "yOffset": 48,
          "zIndex": 0,
          "margin": 12,
          "wrappingMode": "inline",
          "floatOffset": {
            "x": 0,
            "y": 0
          }
        }
      },
      {
        "type": "text",
        "text": "Alice nudged the image beside this paragraph lower on the page."
      }
    ]
  },
  {
    "type": "paragraph",
    "attrs": {
      "align": "left",
      "indent": 0,
      "textIndent": 0,
      "fontFamily": null,
      "dataTracked": []
    },
    "content": [
      {
        "type": "text",
        "text": "Alice added a table below this line."
      }
    ]
  },
  {
    "type": "table",
    "attrs": {
      "layout": "fixed",
      "grid": [
        160,
        160
      ],
      "dataTracked": [
        {
          "id": "demo-object-10",
          "authorID": "alice",
          "reviewedByID": null,
          "createdAt": 1760000000000,
          "updatedAt": 1760000000000,
          "statusUpdateAt": 0,
          "status": "pending",
          "operation": "insert",
          "creationId": "demo-object-10"
        }
      ]
    },
    "content": [
      {
        "type": "tableRow",
        "attrs": {
          "repeatHeader": false,
          "allowBreakAcrossPages": false,
          "dataTracked": [
            {
              "id": "demo-object-11",
              "authorID": "alice",
              "reviewedByID": null,
              "createdAt": 1760000000000,
              "updatedAt": 1760000000000,
              "statusUpdateAt": 0,
              "status": "pending",
              "operation": "insert",
              "creationId": "demo-object-10"
            }
          ]
        },
        "content": [
          {
            "type": "tableCell",
            "attrs": {
              "gridSpan": 1,
              "vMerge": "none",
              "hMerge": "none",
              "hAlign": "left",
              "vAlign": "top",
              "background": null,
              "margins": null,
              "borders": null,
              "dataTracked": [
                {
                  "id": "demo-object-12",
                  "authorID": "alice",
                  "reviewedByID": null,
                  "createdAt": 1760000000000,
                  "updatedAt": 1760000000000,
                  "statusUpdateAt": 0,
                  "status": "pending",
                  "operation": "insert",
                  "creationId": "demo-object-10"
                }
              ]
            },
            "content": [
              {
                "type": "paragraph",
                "attrs": {
                  "align": "left",
                  "indent": 0,
                  "textIndent": 0,
                  "fontFamily": null,
                  "dataTracked": [
                    {
                      "id": "demo-object-13",
                      "authorID": "alice",
                      "reviewedByID": null,
                      "createdAt": 1760000000000,
                      "updatedAt": 1760000000000,
                      "statusUpdateAt": 0,
                      "status": "pending",
                      "operation": "insert",
                      "creationId": "demo-object-10"
                    }
                  ]
                },
                "content": [
                  {
                    "type": "text",
                    "marks": [
                      {
                        "type": "trackedInsert",
                        "attrs": {
                          "dataTracked": {
                            "id": "demo-object-14",
                            "authorID": "alice",
                            "reviewedByID": null,
                            "createdAt": 1760000000000,
                            "updatedAt": 1760000000000,
                            "statusUpdateAt": 0,
                            "status": "pending",
                            "operation": "insert",
                            "creationId": "demo-object-10"
                          }
                        }
                      }
                    ],
                    "text": "A table"
                  }
                ]
              }
            ]
          },
          {
            "type": "tableCell",
            "attrs": {
              "gridSpan": 1,
              "vMerge": "none",
              "hMerge": "none",
              "hAlign": "left",
              "vAlign": "top",
              "background": null,
              "margins": null,
              "borders": null,
              "dataTracked": [
                {
                  "id": "demo-object-15",
                  "authorID": "alice",
                  "reviewedByID": null,
                  "createdAt": 1760000000000,
                  "updatedAt": 1760000000000,
                  "statusUpdateAt": 0,
                  "status": "pending",
                  "operation": "insert",
                  "creationId": "demo-object-10"
                }
              ]
            },
            "content": [
              {
                "type": "paragraph",
                "attrs": {
                  "align": "left",
                  "indent": 0,
                  "textIndent": 0,
                  "fontFamily": null,
                  "dataTracked": [
                    {
                      "id": "demo-object-16",
                      "authorID": "alice",
                      "reviewedByID": null,
                      "createdAt": 1760000000000,
                      "updatedAt": 1760000000000,
                      "statusUpdateAt": 0,
                      "status": "pending",
                      "operation": "insert",
                      "creationId": "demo-object-10"
                    }
                  ]
                },
                "content": [
                  {
                    "type": "text",
                    "marks": [
                      {
                        "type": "trackedInsert",
                        "attrs": {
                          "dataTracked": {
                            "id": "demo-object-17",
                            "authorID": "alice",
                            "reviewedByID": null,
                            "createdAt": 1760000000000,
                            "updatedAt": 1760000000000,
                            "statusUpdateAt": 0,
                            "status": "pending",
                            "operation": "insert",
                            "creationId": "demo-object-10"
                          }
                        }
                      }
                    ],
                    "text": "Alice added"
                  }
                ]
              }
            ]
          }
        ]
      },
      {
        "type": "tableRow",
        "attrs": {
          "repeatHeader": false,
          "allowBreakAcrossPages": false,
          "dataTracked": [
            {
              "id": "demo-object-18",
              "authorID": "alice",
              "reviewedByID": null,
              "createdAt": 1760000000000,
              "updatedAt": 1760000000000,
              "statusUpdateAt": 0,
              "status": "pending",
              "operation": "insert",
              "creationId": "demo-object-10"
            }
          ]
        },
        "content": [
          {
            "type": "tableCell",
            "attrs": {
              "gridSpan": 1,
              "vMerge": "none",
              "hMerge": "none",
              "hAlign": "left",
              "vAlign": "top",
              "background": null,
              "margins": null,
              "borders": null,
              "dataTracked": [
                {
                  "id": "demo-object-19",
                  "authorID": "alice",
                  "reviewedByID": null,
                  "createdAt": 1760000000000,
                  "updatedAt": 1760000000000,
                  "statusUpdateAt": 0,
                  "status": "pending",
                  "operation": "insert",
                  "creationId": "demo-object-10"
                }
              ]
            },
            "content": [
              {
                "type": "paragraph",
                "attrs": {
                  "align": "left",
                  "indent": 0,
                  "textIndent": 0,
                  "fontFamily": null,
                  "dataTracked": [
                    {
                      "id": "demo-object-20",
                      "authorID": "alice",
                      "reviewedByID": null,
                      "createdAt": 1760000000000,
                      "updatedAt": 1760000000000,
                      "statusUpdateAt": 0,
                      "status": "pending",
                      "operation": "insert",
                      "creationId": "demo-object-10"
                    }
                  ]
                },
                "content": [
                  {
                    "type": "text",
                    "marks": [
                      {
                        "type": "trackedInsert",
                        "attrs": {
                          "dataTracked": {
                            "id": "demo-object-21",
                            "authorID": "alice",
                            "reviewedByID": null,
                            "createdAt": 1760000000000,
                            "updatedAt": 1760000000000,
                            "statusUpdateAt": 0,
                            "status": "pending",
                            "operation": "insert",
                            "creationId": "demo-object-10"
                          }
                        }
                      }
                    ],
                    "text": "Accept it"
                  }
                ]
              }
            ]
          },
          {
            "type": "tableCell",
            "attrs": {
              "gridSpan": 1,
              "vMerge": "none",
              "hMerge": "none",
              "hAlign": "left",
              "vAlign": "top",
              "background": null,
              "margins": null,
              "borders": null,
              "dataTracked": [
                {
                  "id": "demo-object-22",
                  "authorID": "alice",
                  "reviewedByID": null,
                  "createdAt": 1760000000000,
                  "updatedAt": 1760000000000,
                  "statusUpdateAt": 0,
                  "status": "pending",
                  "operation": "insert",
                  "creationId": "demo-object-10"
                }
              ]
            },
            "content": [
              {
                "type": "paragraph",
                "attrs": {
                  "align": "left",
                  "indent": 0,
                  "textIndent": 0,
                  "fontFamily": null,
                  "dataTracked": [
                    {
                      "id": "demo-object-23",
                      "authorID": "alice",
                      "reviewedByID": null,
                      "createdAt": 1760000000000,
                      "updatedAt": 1760000000000,
                      "statusUpdateAt": 0,
                      "status": "pending",
                      "operation": "insert",
                      "creationId": "demo-object-10"
                    }
                  ]
                },
                "content": [
                  {
                    "type": "text",
                    "marks": [
                      {
                        "type": "trackedInsert",
                        "attrs": {
                          "dataTracked": {
                            "id": "demo-object-24",
                            "authorID": "alice",
                            "reviewedByID": null,
                            "createdAt": 1760000000000,
                            "updatedAt": 1760000000000,
                            "statusUpdateAt": 0,
                            "status": "pending",
                            "operation": "insert",
                            "creationId": "demo-object-10"
                          }
                        }
                      }
                    ],
                    "text": "or reject it"
                  }
                ]
              }
            ]
          }
        ]
      }
    ]
  },
  {
    "type": "paragraph",
    "attrs": {
      "align": "left",
      "indent": 0,
      "textIndent": 0,
      "fontFamily": null,
      "dataTracked": [
        {
          "id": "demo-object-25",
          "authorID": "alice",
          "reviewedByID": null,
          "createdAt": 1760000000000,
          "updatedAt": 1760000000000,
          "statusUpdateAt": 0,
          "status": "pending",
          "moveNodeId": "demo-object-2",
          "operation": "move",
          "dependsOn": [],
          "placementDependsOn": []
        }
      ]
    },
    "content": [
      {
        "type": "text",
        "text": "Alice moved this paragraph from here to below the table."
      }
    ]
  },
  {
    "type": "horizontalRule",
    "attrs": {
      "dataTracked": [
        {
          "id": "demo-object-26",
          "authorID": "alice",
          "reviewedByID": null,
          "createdAt": 1760000000000,
          "updatedAt": 1760000000000,
          "statusUpdateAt": 0,
          "status": "pending",
          "operation": "delete"
        }
      ]
    }
  },
  {
    "type": "paragraph",
    "attrs": {
      "align": "left",
      "indent": 0,
      "textIndent": 0,
      "fontFamily": null,
      "dataTracked": []
    },
    "content": [
      {
        "type": "text",
        "text": "Alice removed the rule above, and added a code block below."
      }
    ]
  },
  {
    "type": "codeBlock",
    "attrs": {
      "dataTracked": [
        {
          "id": "demo-object-27",
          "authorID": "alice",
          "reviewedByID": null,
          "createdAt": 1760000000000,
          "updatedAt": 1760000000000,
          "statusUpdateAt": 0,
          "status": "pending",
          "operation": "insert",
          "creationId": "demo-object-27"
        }
      ]
    },
    "content": [
      {
        "type": "text",
        "marks": [
          {
            "type": "trackedInsert",
            "attrs": {
              "dataTracked": {
                "id": "demo-object-28",
                "authorID": "alice",
                "reviewedByID": null,
                "createdAt": 1760000000000,
                "updatedAt": 1760000000000,
                "statusUpdateAt": 0,
                "status": "pending",
                "operation": "insert",
                "creationId": "demo-object-27"
              }
            }
          }
        ],
        "text": "review.accept(change);"
      }
    ]
  },
  {
    "type": "heading",
    "attrs": {
      "level": 3,
      "align": "left",
      "indent": 0,
      "textIndent": 0,
      "fontFamily": null,
      "dataTracked": [
        {
          "id": "demo-object-29",
          "authorID": "alice",
          "reviewedByID": null,
          "createdAt": 1760000000000,
          "updatedAt": 1760000000000,
          "statusUpdateAt": 0,
          "status": "pending",
          "operation": "set_attrs",
          "oldAttrs": {
            "align": "left",
            "indent": 0,
            "textIndent": 0,
            "fontFamily": null
          },
          "oldNodeTypeName": "paragraph"
        }
      ]
    },
    "content": [
      {
        "type": "text",
        "text": "Alice turned this paragraph into a heading."
      }
    ]
  },
  {
    "type": "paragraph",
    "attrs": {
      "align": "left",
      "indent": 0,
      "textIndent": 0,
      "fontFamily": null,
      "dataTracked": []
    },
    "content": [
      {
        "type": "text",
        "text": "The end of the section."
      }
    ]
  }
];

/**
 * Alice's pending style changes, recorded the same way: a heading made one
 * level smaller, a heading turned back into a paragraph and a paragraph into a
 * heading, alignment and indentation, formatting added and removed on words
 * (bold, italics, colour, size, highlight, link), and a bulleted list made
 * numbered.
 */
export const ALICE_STYLE_CHANGES: unknown[] = [
  {
    "type": "heading",
    "attrs": {
      "level": 2,
      "align": "left",
      "indent": 0,
      "textIndent": 0,
      "fontFamily": null,
      "dataTracked": [
        {
          "id": "demo-style-1",
          "authorID": "alice",
          "reviewedByID": null,
          "createdAt": 1760000000000,
          "updatedAt": 1760000000000,
          "statusUpdateAt": 0,
          "status": "pending",
          "operation": "set_attrs",
          "oldAttrs": {
            "level": 1,
            "align": "left",
            "indent": 0,
            "textIndent": 0,
            "fontFamily": null
          }
        }
      ]
    },
    "content": [
      {
        "type": "text",
        "text": "Alice made this heading one level smaller"
      }
    ]
  },
  {
    "type": "paragraph",
    "attrs": {
      "align": "left",
      "indent": 0,
      "textIndent": 0,
      "fontFamily": null,
      "dataTracked": [
        {
          "id": "demo-style-2",
          "authorID": "alice",
          "reviewedByID": null,
          "createdAt": 1760000000000,
          "updatedAt": 1760000000000,
          "statusUpdateAt": 0,
          "status": "pending",
          "operation": "set_attrs",
          "oldAttrs": {
            "level": 2,
            "align": "left",
            "indent": 0,
            "textIndent": 0,
            "fontFamily": null
          },
          "oldNodeTypeName": "heading"
        }
      ]
    },
    "content": [
      {
        "type": "text",
        "text": "Alice turned this heading back into a paragraph"
      }
    ]
  },
  {
    "type": "heading",
    "attrs": {
      "level": 3,
      "align": "left",
      "indent": 0,
      "textIndent": 0,
      "fontFamily": null,
      "dataTracked": [
        {
          "id": "demo-style-3",
          "authorID": "alice",
          "reviewedByID": null,
          "createdAt": 1760000000000,
          "updatedAt": 1760000000000,
          "statusUpdateAt": 0,
          "status": "pending",
          "operation": "set_attrs",
          "oldAttrs": {
            "align": "left",
            "indent": 0,
            "textIndent": 0,
            "fontFamily": null
          },
          "oldNodeTypeName": "paragraph"
        }
      ]
    },
    "content": [
      {
        "type": "text",
        "text": "Alice turned this paragraph into a heading."
      }
    ]
  },
  {
    "type": "paragraph",
    "attrs": {
      "align": "center",
      "indent": 0,
      "textIndent": 0,
      "fontFamily": null,
      "dataTracked": [
        {
          "id": "demo-style-4",
          "authorID": "alice",
          "reviewedByID": null,
          "createdAt": 1760000000000,
          "updatedAt": 1760000000000,
          "statusUpdateAt": 0,
          "status": "pending",
          "operation": "set_attrs",
          "oldAttrs": {
            "align": "left",
            "indent": 0,
            "textIndent": 0,
            "fontFamily": null
          }
        }
      ]
    },
    "content": [
      {
        "type": "text",
        "text": "Alice centred this paragraph."
      }
    ]
  },
  {
    "type": "paragraph",
    "attrs": {
      "align": "left",
      "indent": 1,
      "textIndent": 0,
      "fontFamily": null,
      "dataTracked": [
        {
          "id": "demo-style-5",
          "authorID": "alice",
          "reviewedByID": null,
          "createdAt": 1760000000000,
          "updatedAt": 1760000000000,
          "statusUpdateAt": 0,
          "status": "pending",
          "operation": "set_attrs",
          "oldAttrs": {
            "align": "left",
            "indent": 0,
            "textIndent": 0,
            "fontFamily": null
          }
        }
      ]
    },
    "content": [
      {
        "type": "text",
        "text": "Alice indented this paragraph."
      }
    ]
  },
  {
    "type": "paragraph",
    "attrs": {
      "align": "left",
      "indent": 0,
      "textIndent": 0,
      "fontFamily": null,
      "dataTracked": []
    },
    "content": [
      {
        "type": "text",
        "text": "Alice made "
      },
      {
        "type": "text",
        "marks": [
          {
            "type": "bold",
            "attrs": {
              "dataTracked": [
                {
                  "authorID": "alice",
                  "reviewedByID": null,
                  "createdAt": 1760000000000,
                  "updatedAt": 1760000000000,
                  "statusUpdateAt": 0,
                  "status": "pending",
                  "operation": "insert",
                  "id": "demo-style-6"
                }
              ]
            }
          }
        ],
        "text": "these words"
      },
      {
        "type": "text",
        "text": " bold, and took the italics off "
      },
      {
        "type": "text",
        "marks": [
          {
            "type": "italic",
            "attrs": {
              "dataTracked": [
                {
                  "authorID": "alice",
                  "reviewedByID": null,
                  "createdAt": 1760000000000,
                  "updatedAt": 1760000000000,
                  "statusUpdateAt": 0,
                  "status": "pending",
                  "operation": "delete",
                  "id": "demo-style-7"
                }
              ]
            }
          }
        ],
        "text": "these ones"
      },
      {
        "type": "text",
        "text": "."
      }
    ]
  },
  {
    "type": "paragraph",
    "attrs": {
      "align": "left",
      "indent": 0,
      "textIndent": 0,
      "fontFamily": null,
      "dataTracked": []
    },
    "content": [
      {
        "type": "text",
        "text": "Alice coloured "
      },
      {
        "type": "text",
        "marks": [
          {
            "type": "color",
            "attrs": {
              "color": "#dc2626",
              "dataTracked": [
                {
                  "authorID": "alice",
                  "reviewedByID": null,
                  "createdAt": 1760000000000,
                  "updatedAt": 1760000000000,
                  "statusUpdateAt": 0,
                  "status": "pending",
                  "operation": "insert",
                  "id": "demo-style-8"
                }
              ]
            }
          }
        ],
        "text": "these words"
      },
      {
        "type": "text",
        "text": " red and made "
      },
      {
        "type": "text",
        "marks": [
          {
            "type": "fontSize",
            "attrs": {
              "size": 20,
              "dataTracked": [
                {
                  "authorID": "alice",
                  "reviewedByID": null,
                  "createdAt": 1760000000000,
                  "updatedAt": 1760000000000,
                  "statusUpdateAt": 0,
                  "status": "pending",
                  "operation": "insert",
                  "id": "demo-style-9"
                }
              ]
            }
          }
        ],
        "text": "this phrase"
      },
      {
        "type": "text",
        "text": " larger."
      }
    ]
  },
  {
    "type": "paragraph",
    "attrs": {
      "align": "left",
      "indent": 0,
      "textIndent": 0,
      "fontFamily": null,
      "dataTracked": []
    },
    "content": [
      {
        "type": "text",
        "text": "Alice highlighted "
      },
      {
        "type": "text",
        "marks": [
          {
            "type": "highlight",
            "attrs": {
              "dataTracked": [
                {
                  "authorID": "alice",
                  "reviewedByID": null,
                  "createdAt": 1760000000000,
                  "updatedAt": 1760000000000,
                  "statusUpdateAt": 0,
                  "status": "pending",
                  "operation": "insert",
                  "id": "demo-style-10"
                }
              ]
            }
          }
        ],
        "text": "a few words"
      },
      {
        "type": "text",
        "text": " and linked "
      },
      {
        "type": "text",
        "marks": [
          {
            "type": "link",
            "attrs": {
              "href": "https://scrivr.dev",
              "title": null,
              "dataTracked": [
                {
                  "authorID": "alice",
                  "reviewedByID": null,
                  "createdAt": 1760000000000,
                  "updatedAt": 1760000000000,
                  "statusUpdateAt": 0,
                  "status": "pending",
                  "operation": "insert",
                  "id": "demo-style-11"
                }
              ]
            }
          }
        ],
        "text": "these ones"
      },
      {
        "type": "text",
        "text": "."
      }
    ]
  },
  {
    "type": "orderedList",
    "attrs": {
      "order": 1,
      "dataTracked": []
    },
    "content": [
      {
        "type": "listItem",
        "attrs": {
          "dataTracked": []
        },
        "content": [
          {
            "type": "paragraph",
            "attrs": {
              "align": "left",
              "indent": 0,
              "textIndent": 0,
              "fontFamily": null,
              "dataTracked": [
                {
                  "id": "demo-style-12",
                  "authorID": "alice",
                  "reviewedByID": null,
                  "createdAt": 1760000000000,
                  "updatedAt": 1760000000000,
                  "statusUpdateAt": 0,
                  "status": "pending",
                  "operation": "list_change",
                  "oldList": [
                    {
                      "type": "bulletList",
                      "attrs": {
                        "dataTracked": null
                      },
                      "item": {
                        "dataTracked": null
                      },
                      "startsItem": true
                    }
                  ]
                }
              ]
            },
            "content": [
              {
                "type": "text",
                "text": "Alice turned this bulleted list"
              }
            ]
          }
        ]
      },
      {
        "type": "listItem",
        "attrs": {
          "dataTracked": []
        },
        "content": [
          {
            "type": "paragraph",
            "attrs": {
              "align": "left",
              "indent": 0,
              "textIndent": 0,
              "fontFamily": null,
              "dataTracked": [
                {
                  "id": "demo-style-13",
                  "authorID": "alice",
                  "reviewedByID": null,
                  "createdAt": 1760000000000,
                  "updatedAt": 1760000000000,
                  "statusUpdateAt": 0,
                  "status": "pending",
                  "operation": "list_change",
                  "oldList": [
                    {
                      "type": "bulletList",
                      "attrs": {
                        "dataTracked": null
                      },
                      "item": {
                        "dataTracked": null
                      },
                      "startsItem": true
                    }
                  ],
                  "continuesId": "demo-style-12"
                }
              ]
            },
            "content": [
              {
                "type": "text",
                "text": "into a numbered one."
              }
            ]
          }
        ]
      }
    ]
  },
  {
    "type": "paragraph",
    "attrs": {
      "align": "left",
      "indent": 0,
      "textIndent": 0,
      "fontFamily": null,
      "dataTracked": []
    }
  }
];
